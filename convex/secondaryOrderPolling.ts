import { anyApi, internalActionGeneric } from 'convex/server';
import { v } from 'convex/values';
import { createSalesforceServerlessClient, SalesforceSecondaryOrder } from './salesforce';
import { callSlackWebApi } from './slackApi';
import { env } from './_generated/server';

const POLL_LEASE_MS = 4 * 60 * 1000;
const MAX_SCOPES_PER_RUN = 25;

export interface SecondaryOrderPollingScopeInput {
  scopeKey: string;
  teamId: string;
  slackUserId: string;
  salesforceAccountId: string;
  notificationChannelId: string;
  configurationVersion: number;
  pollLeaseOwner: string;
}

type ReconcileOutcome = {
  scopeKey: string;
  delivered: number;
  salesforceRead: 'not_attempted' | 'success' | 'failure';
  reason:
    | 'ok'
    | 'scope_or_lease_changed'
    | 'unseeded_scope'
    | 'salesforce_read_failed'
    | 'notification_processing'
    | 'notification_failed'
    | 'slack_delivery_ambiguous'
    | 'delivery_record_incomplete';
};

export function orderWatermark(order: Pick<SalesforceSecondaryOrder, 'createdAt' | 'orderId'>): string {
  return `${order.createdAt}|${order.orderId}`;
}

/**
 * Salesforce returns this result newest-first. A strict watermark comparison
 * makes a seeded snapshot a no-notification boundary, even across cold starts.
 * An absent watermark is valid only when the scope carries seed evidence for
 * an empty Salesforce snapshot.
 */
export function ordersAfterWatermark(orders: SalesforceSecondaryOrder[], watermark?: string): SalesforceSecondaryOrder[] {
  return orders
    .filter((order) => watermark === undefined || orderWatermark(order) > watermark)
    .sort((left, right) => compareWatermarks(orderWatermark(left), orderWatermark(right)));
}

function compareWatermarks(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function secondaryOrderNotificationText(order: SalesforceSecondaryOrder): string {
  const partialNote = order.fulfillmentStatus === 'Partially Fulfilled' || order.invoiceStatus === 'Partial'
    ? ' :warning: *PARTIAL*'
    : '';
  return `:twisted_rightwards_arrows: New Secondary Order: *${order.orderNumber}*${partialNote}\nRetailer: ${order.retailerCustomer}\nAmount: Rs ${formatIndianCurrency(order.totalAmount)}\nStatus: ${order.status} | Invoice: ${order.invoiceStatus || 'N/A'} | Fulfillment: ${order.fulfillmentStatus || 'N/A'}`;
}

function formatIndianCurrency(value: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

/** Creates or replaces a disabled scope. It cannot enable notifications. */
export const configureScope = internalActionGeneric({
  args: {
    scopeKey: v.string(), teamId: v.string(), slackUserId: v.string(), salesforceAccountId: v.string(), notificationChannelId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(anyApi.operationalState.configureSecondaryOrderPollingScope, { ...args, now: Date.now() });
    return { configured: true, notificationsEnabled: false };
  },
});

/**
 * Captures the current Salesforce snapshot as the starting boundary. Starting
 * a seed atomically disables the scope; a failed or superseded read can never
 * leave notifications enabled.
 */
export const seedScopeWatermark = internalActionGeneric({
  args: { scopeKey: v.string() },
  handler: async (ctx, args) => {
    const seed = await ctx.runMutation(anyApi.operationalState.beginSecondaryOrderWatermarkSeed, { ...args, now: Date.now() });
    if (!seed) return { seeded: false, reason: 'scope_not_found' };

    let orders: SalesforceSecondaryOrder[];
    try {
      orders = await createSalesforceServerlessClient().getSecondaryOrdersForAccount(seed.salesforceAccountId, { newestOnly: true });
    } catch {
      const result = await ctx.runMutation(anyApi.operationalState.failSecondaryOrderWatermarkSeed, {
        scopeKey: seed.scopeKey,
        configurationVersion: seed.configurationVersion,
        seedGeneration: seed.seedGeneration,
        salesforceAccountId: seed.salesforceAccountId,
        slackUserId: seed.slackUserId,
        now: Date.now(),
        failureCode: 'SALESFORCE_READ_FAILED',
      });
      if (result.updated) {
        await ctx.runMutation(anyApi.operationalState.recordIntegrationStatus, {
          component: 'salesforce', outcome: 'failure', now: Date.now(), errorCode: 'SALESFORCE_READ_FAILED',
        });
      }
      return { seeded: false, reason: result.updated ? 'salesforce_read_failed' : result.reason };
    }

    const newest = orders.reduce<string | undefined>((current, order) => {
      const candidate = orderWatermark(order);
      return current === undefined || candidate > current ? candidate : current;
    }, undefined);
    const result = await ctx.runMutation(anyApi.operationalState.finishSecondaryOrderWatermarkSeed, {
      scopeKey: seed.scopeKey,
      configurationVersion: seed.configurationVersion,
      seedGeneration: seed.seedGeneration,
      salesforceAccountId: seed.salesforceAccountId,
      slackUserId: seed.slackUserId,
      watermark: newest,
      observedOrderCount: orders.length,
      now: Date.now(),
    });
    if (!result.updated) return { seeded: false, reason: result.reason };
    await ctx.runMutation(anyApi.operationalState.recordIntegrationStatus, {
      component: 'salesforce', outcome: 'success', now: Date.now(),
    });
    return { seeded: true, ordersObserved: orders.length, emptySnapshot: orders.length === 0 };
  },
});

/** Requires a previously successful seed; it never seeds or delivers itself. */
export const enableSeededScope = internalActionGeneric({
  args: { scopeKey: v.string() },
  handler: async (ctx, args) => ({
    enabled: await ctx.runMutation(anyApi.operationalState.enableSeededSecondaryOrderPollingScope, { ...args, now: Date.now() }),
  }),
});

/** An immediate, owner-aware stop that also invalidates any in-flight lease. */
export const disableScope = internalActionGeneric({
  args: { scopeKey: v.string() },
  handler: async (ctx, args) => ({
    disabled: await ctx.runMutation(anyApi.operationalState.disableSecondaryOrderPollingScope, { ...args, now: Date.now() }),
  }),
});

/**
 * The function remains unregistered in crons.ts. Even if invoked manually, it
 * performs no Salesforce or Slack call unless an enabled, seeded scope is
 * atomically leased.
 */
export const reconcileEnabledScopes = internalActionGeneric({
  args: {},
  handler: async (ctx) => {
    const leaseOwner = crypto.randomUUID();
    const claim = await ctx.runMutation(anyApi.operationalState.claimEnabledSecondaryOrderPollingScopes, {
      now: Date.now(), leaseMs: POLL_LEASE_MS, leaseOwner, limit: MAX_SCOPES_PER_RUN,
    });
    if (claim.enabledScopeCount === 0) {
      await ctx.runMutation(anyApi.operationalState.recordIntegrationStatus, {
        component: 'secondaryOrderPoller', outcome: 'not_configured', now: Date.now(),
      });
      return { scopesClaimed: 0, enabledScopeCount: 0, outcomes: [] };
    }
    if (claim.scopes.length === 0) {
      // Another invocation owns the leases. Do not overwrite its health result.
      return { scopesClaimed: 0, enabledScopeCount: claim.enabledScopeCount, outcomes: [] };
    }

    const outcomes: ReconcileOutcome[] = [];
    for (const scope of claim.scopes) {
      try {
        outcomes.push(await reconcileScope(ctx, scope));
      } catch {
        outcomes.push({ scopeKey: scope.scopeKey, delivered: 0, salesforceRead: 'not_attempted', reason: 'delivery_record_incomplete' });
      } finally {
        await ctx.runMutation(anyApi.operationalState.releaseSecondaryOrderPollingLease, {
          scopeKey: scope.scopeKey, leaseOwner, now: Date.now(),
        });
      }
    }

    const failed = outcomes.find((outcome) => outcome.reason !== 'ok');
    await ctx.runMutation(anyApi.operationalState.recordIntegrationStatus, failed
      ? { component: 'secondaryOrderPoller', outcome: 'failure', now: Date.now(), errorCode: failed.reason.toUpperCase() }
      : { component: 'secondaryOrderPoller', outcome: 'success', now: Date.now() });
    const salesforceFailure = outcomes.some((outcome) => outcome.salesforceRead === 'failure');
    const salesforceSuccess = outcomes.some((outcome) => outcome.salesforceRead === 'success');
    if (salesforceFailure || salesforceSuccess) {
      await ctx.runMutation(anyApi.operationalState.recordIntegrationStatus, salesforceFailure
        ? { component: 'salesforce', outcome: 'failure', now: Date.now(), errorCode: 'SALESFORCE_READ_FAILED' }
        : { component: 'salesforce', outcome: 'success', now: Date.now() });
    }
    return { scopesClaimed: claim.scopes.length, enabledScopeCount: claim.enabledScopeCount, outcomes };
  },
});

async function reconcileScope(ctx: any, scope: SecondaryOrderPollingScopeInput): Promise<ReconcileOutcome> {
  if (!await leaseIsCurrent(ctx, scope)) {
    return { scopeKey: scope.scopeKey, delivered: 0, salesforceRead: 'not_attempted', reason: 'scope_or_lease_changed' };
  }
  const watermark = await ctx.runQuery(anyApi.operationalState.getSecondaryOrderWatermark, { scopeKey: scope.scopeKey });
  if (!watermark) {
    return { scopeKey: scope.scopeKey, delivered: 0, salesforceRead: 'not_attempted', reason: 'unseeded_scope' };
  }

  let orders: SalesforceSecondaryOrder[];
  try {
    orders = await createSalesforceServerlessClient().getSecondaryOrdersForAccount(scope.salesforceAccountId, {
      afterWatermark: watermark.lastOrderWatermark,
    });
  } catch {
    await recordPollFailure(ctx, scope, 'SALESFORCE_READ_FAILED');
    return { scopeKey: scope.scopeKey, delivered: 0, salesforceRead: 'failure', reason: 'salesforce_read_failed' };
  }
  if (!await leaseIsCurrent(ctx, scope)) {
    return { scopeKey: scope.scopeKey, delivered: 0, salesforceRead: 'success', reason: 'scope_or_lease_changed' };
  }

  const newOrders = ordersAfterWatermark(orders, watermark.lastOrderWatermark);
  let delivered = 0;
  for (const order of newOrders) {
    if (!await leaseIsCurrent(ctx, scope)) {
      return { scopeKey: scope.scopeKey, delivered, salesforceRead: 'success', reason: 'scope_or_lease_changed' };
    }

    const reservation = await ctx.runMutation(anyApi.operationalState.beginSecondaryOrderNotification, {
      scopeKey: scope.scopeKey,
      salesforceOrderId: order.orderId,
      orderWatermark: orderWatermark(order),
      now: Date.now(),
    });
    if (!reservation.acquired) {
      if (reservation.status === 'sent' || reservation.status === 'skipped') continue;
      const reason = reservation.status === 'processing' ? 'notification_processing' : 'notification_failed';
      await recordPollFailure(ctx, scope, reason.toUpperCase());
      return { scopeKey: scope.scopeKey, delivered, salesforceRead: 'success', reason };
    }

    // Narrow the disable/reconfigure race again after the durable reservation
    // and before the only external side effect.
    if (!await leaseIsCurrent(ctx, scope)) {
      await ctx.runMutation(anyApi.operationalState.recordSecondaryOrderNotification, {
        scopeKey: scope.scopeKey,
        salesforceOrderId: order.orderId,
        orderWatermark: orderWatermark(order),
        status: 'failed',
        now: Date.now(),
        failureCode: 'SCOPE_CHANGED_BEFORE_DELIVERY',
      });
      return { scopeKey: scope.scopeKey, delivered, salesforceRead: 'success', reason: 'scope_or_lease_changed' };
    }

    try {
      await callSlackWebApi(env.SLACK_BOT_TOKEN, 'chat.postMessage', {
        channel: scope.notificationChannelId,
        text: secondaryOrderNotificationText(order),
      });
    } catch {
      await ctx.runMutation(anyApi.operationalState.recordSecondaryOrderNotification, {
        scopeKey: scope.scopeKey,
        salesforceOrderId: order.orderId,
        orderWatermark: orderWatermark(order),
        status: 'failed',
        now: Date.now(),
        failureCode: 'SLACK_DELIVERY_AMBIGUOUS',
      });
      await recordPollFailure(ctx, scope, 'SLACK_DELIVERY_AMBIGUOUS');
      return { scopeKey: scope.scopeKey, delivered, salesforceRead: 'success', reason: 'slack_delivery_ambiguous' };
    }

    // Slack returned ok=true, so the message is known sent. If the durable
    // mutation fails, leave the processing reservation and do not advance the
    // watermark; the next run stops for review instead of sending a duplicate.
    const recorded = await ctx.runMutation(anyApi.operationalState.recordSecondaryOrderNotification, {
      scopeKey: scope.scopeKey,
      salesforceOrderId: order.orderId,
      orderWatermark: orderWatermark(order),
      status: 'sent',
      now: Date.now(),
    });
    if (!recorded.recorded && recorded.status !== 'sent') {
      await recordPollFailure(ctx, scope, 'DELIVERY_RECORD_INCOMPLETE');
      return { scopeKey: scope.scopeKey, delivered, salesforceRead: 'success', reason: 'delivery_record_incomplete' };
    }
    delivered += 1;
  }

  const newest = newOrders.length > 0 ? orderWatermark(newOrders[newOrders.length - 1]) : watermark.lastOrderWatermark;
  const recorded = await ctx.runMutation(anyApi.operationalState.recordSecondaryOrderPollResult, {
    scopeKey: scope.scopeKey,
    configurationVersion: scope.configurationVersion,
    leaseOwner: scope.pollLeaseOwner,
    salesforceAccountId: scope.salesforceAccountId,
    slackUserId: scope.slackUserId,
    status: 'success',
    watermark: newest,
    now: Date.now(),
  });
  return recorded.updated
    ? { scopeKey: scope.scopeKey, delivered, salesforceRead: 'success', reason: 'ok' }
    : { scopeKey: scope.scopeKey, delivered, salesforceRead: 'success', reason: 'scope_or_lease_changed' };
}

async function leaseIsCurrent(ctx: any, scope: SecondaryOrderPollingScopeInput): Promise<boolean> {
  return ctx.runQuery(anyApi.operationalState.isSecondaryOrderPollingLeaseCurrent, {
    scopeKey: scope.scopeKey,
    configurationVersion: scope.configurationVersion,
    leaseOwner: scope.pollLeaseOwner,
    now: Date.now(),
  });
}

async function recordPollFailure(ctx: any, scope: SecondaryOrderPollingScopeInput, failureCode: string): Promise<void> {
  await ctx.runMutation(anyApi.operationalState.recordSecondaryOrderPollResult, {
    scopeKey: scope.scopeKey,
    configurationVersion: scope.configurationVersion,
    leaseOwner: scope.pollLeaseOwner,
    salesforceAccountId: scope.salesforceAccountId,
    slackUserId: scope.slackUserId,
    status: 'failure',
    now: Date.now(),
    failureCode,
  });
}
