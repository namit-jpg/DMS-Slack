import { describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../../convex/schema';
import { internal } from '../../convex/_generated/api';
import { orderWatermark, ordersAfterWatermark, secondaryOrderNotificationText } from '../../convex/secondaryOrderPolling';

const operationalState = (internal as any).operationalState;

function makeTestBackend() {
  return convexTest(schema, {
    '_generated/api': async () => ({}),
    operationalState: () => import('../../convex/operationalState'),
    secondaryOrderPolling: () => import('../../convex/secondaryOrderPolling'),
  });
}

const scopeArgs = {
  scopeKey: 'T1:U1:001',
  teamId: 'T1',
  slackUserId: 'U1',
  salesforceAccountId: '001',
  notificationChannelId: 'C1',
};

async function configureAndBeginSeed(t: ReturnType<typeof makeTestBackend>, now = 100) {
  await t.mutation(operationalState.configureSecondaryOrderPollingScope, { ...scopeArgs, now });
  return t.mutation(operationalState.beginSecondaryOrderWatermarkSeed, { scopeKey: scopeArgs.scopeKey, now: now + 1 });
}

describe('secondary-order polling boundaries', () => {
  const older = {
    orderId: '801-old', orderNumber: '0001', retailerCustomer: 'Retailer A', status: 'Draft', totalAmount: 1000,
    fulfillmentStatus: 'Draft', invoiceStatus: '', createdAt: '2026-08-09T10:00:00.000+0000',
  };
  const newer = {
    ...older, orderId: '801-new', orderNumber: '0002', createdAt: '2026-08-09T10:01:00.000+0000',
  };

  it('uses a stable created-at plus Salesforce-id watermark and processes oldest new orders first', () => {
    expect(orderWatermark(older)).toBe('2026-08-09T10:00:00.000+0000|801-old');
    expect(ordersAfterWatermark([newer, older], orderWatermark(older))).toEqual([newer]);
    expect(ordersAfterWatermark([newer, older])).toEqual([older, newer]);
  });

  it('preserves the legacy notification wording without an implicit default channel', () => {
    expect(secondaryOrderNotificationText({ ...newer, fulfillmentStatus: 'Partially Fulfilled', invoiceStatus: 'Partial' }))
      .toContain('New Secondary Order: *0002* :warning: *PARTIAL*');
    expect(secondaryOrderNotificationText(newer)).toContain('Amount: Rs 1,000');
  });

  it('is network-inert when no enabled scope exists', async () => {
    const t = makeTestBackend();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(t.action((internal as any).secondaryOrderPolling.reconcileEnabledScopes, {})).resolves.toEqual({
      scopesClaimed: 0,
      enabledScopeCount: 0,
      outcomes: [],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    await expect(t.query(operationalState.getIntegrationStatus, { component: 'secondaryOrderPoller' })).resolves.toMatchObject({
      status: 'not_configured', consecutiveFailureCount: 0,
    });
  });

  it('treats a successful empty snapshot as a valid seed and clears a stale watermark', async () => {
    const t = makeTestBackend();
    const firstSeed = await configureAndBeginSeed(t);
    await t.mutation(operationalState.finishSecondaryOrderWatermarkSeed, {
      scopeKey: firstSeed.scopeKey,
      configurationVersion: firstSeed.configurationVersion,
      seedGeneration: firstSeed.seedGeneration,
      salesforceAccountId: firstSeed.salesforceAccountId,
      slackUserId: firstSeed.slackUserId,
      watermark: orderWatermark(older),
      observedOrderCount: 1,
      now: 102,
    });

    const emptySeed = await t.mutation(operationalState.beginSecondaryOrderWatermarkSeed, { scopeKey: scopeArgs.scopeKey, now: 103 });
    await expect(t.mutation(operationalState.finishSecondaryOrderWatermarkSeed, {
      scopeKey: emptySeed.scopeKey,
      configurationVersion: emptySeed.configurationVersion,
      seedGeneration: emptySeed.seedGeneration,
      salesforceAccountId: emptySeed.salesforceAccountId,
      slackUserId: emptySeed.slackUserId,
      observedOrderCount: 0,
      now: 104,
    })).resolves.toEqual({ updated: true, reason: 'seeded' });

    await expect(t.query(operationalState.getSecondaryOrderWatermark, { scopeKey: scopeArgs.scopeKey }))
      .resolves.toMatchObject({ lastSuccessfulPollAt: 104 });
    expect((await t.query(operationalState.getSecondaryOrderWatermark, { scopeKey: scopeArgs.scopeKey })).lastOrderWatermark).toBeUndefined();
    await expect(t.mutation(operationalState.enableSeededSecondaryOrderPollingScope, { scopeKey: scopeArgs.scopeKey, now: 105 })).resolves.toBe(true);
  });

  it('rejects a stale seed result after scope reconfiguration without patching a watermark', async () => {
    const t = makeTestBackend();
    const staleSeed = await configureAndBeginSeed(t);
    await t.mutation(operationalState.configureSecondaryOrderPollingScope, {
      ...scopeArgs, notificationChannelId: 'C2', now: 102,
    });

    await expect(t.mutation(operationalState.finishSecondaryOrderWatermarkSeed, {
      scopeKey: staleSeed.scopeKey,
      configurationVersion: staleSeed.configurationVersion,
      seedGeneration: staleSeed.seedGeneration,
      salesforceAccountId: staleSeed.salesforceAccountId,
      slackUserId: staleSeed.slackUserId,
      watermark: orderWatermark(older),
      observedOrderCount: 1,
      now: 103,
    })).resolves.toEqual({ updated: false, reason: 'scope_changed' });
    await expect(t.query(operationalState.getSecondaryOrderWatermark, { scopeKey: scopeArgs.scopeKey })).resolves.toBeNull();
  });

  it('records a failed reseed while preserving the known-good success boundary', async () => {
    const t = makeTestBackend();
    const firstSeed = await configureAndBeginSeed(t);
    await t.mutation(operationalState.finishSecondaryOrderWatermarkSeed, {
      scopeKey: firstSeed.scopeKey,
      configurationVersion: firstSeed.configurationVersion,
      seedGeneration: firstSeed.seedGeneration,
      salesforceAccountId: firstSeed.salesforceAccountId,
      slackUserId: firstSeed.slackUserId,
      watermark: orderWatermark(older),
      observedOrderCount: 1,
      now: 102,
    });
    const failedSeed = await t.mutation(operationalState.beginSecondaryOrderWatermarkSeed, { scopeKey: scopeArgs.scopeKey, now: 110 });
    await t.mutation(operationalState.failSecondaryOrderWatermarkSeed, {
      scopeKey: failedSeed.scopeKey,
      configurationVersion: failedSeed.configurationVersion,
      seedGeneration: failedSeed.seedGeneration,
      salesforceAccountId: failedSeed.salesforceAccountId,
      slackUserId: failedSeed.slackUserId,
      now: 111,
      failureCode: 'SALESFORCE_READ_FAILED',
    });

    await expect(t.query(operationalState.getSecondaryOrderWatermark, { scopeKey: scopeArgs.scopeKey })).resolves.toMatchObject({
      lastOrderWatermark: orderWatermark(older),
      lastSuccessfulPollAt: 102,
      lastFailureCode: 'SALESFORCE_READ_FAILED',
      lastFailureAt: 111,
    });
    await expect(t.mutation(operationalState.enableSeededSecondaryOrderPollingScope, { scopeKey: scopeArgs.scopeKey, now: 112 })).resolves.toBe(false);
  });

  it('keeps polling inert until enabled and enforces owner-aware lease transitions', async () => {
    const t = makeTestBackend();
    const seed = await configureAndBeginSeed(t);
    await t.mutation(operationalState.finishSecondaryOrderWatermarkSeed, {
      scopeKey: seed.scopeKey,
      configurationVersion: seed.configurationVersion,
      seedGeneration: seed.seedGeneration,
      salesforceAccountId: seed.salesforceAccountId,
      slackUserId: seed.slackUserId,
      observedOrderCount: 0,
      now: 102,
    });

    await expect(t.mutation(operationalState.claimEnabledSecondaryOrderPollingScopes, {
      now: 103, leaseMs: 5_000, leaseOwner: 'worker-a', limit: 25,
    })).resolves.toMatchObject({ scopes: [], enabledScopeCount: 0 });
    await t.mutation(operationalState.enableSeededSecondaryOrderPollingScope, { scopeKey: scopeArgs.scopeKey, now: 104 });
    const firstClaim = await t.mutation(operationalState.claimEnabledSecondaryOrderPollingScopes, {
      now: 105, leaseMs: 5_000, leaseOwner: 'worker-a', limit: 25,
    });
    expect(firstClaim.scopes).toHaveLength(1);
    await expect(t.mutation(operationalState.claimEnabledSecondaryOrderPollingScopes, {
      now: 106, leaseMs: 5_000, leaseOwner: 'worker-b', limit: 25,
    })).resolves.toMatchObject({ scopes: [], enabledScopeCount: 1 });
    await expect(t.mutation(operationalState.releaseSecondaryOrderPollingLease, {
      scopeKey: scopeArgs.scopeKey, leaseOwner: 'worker-b', now: 107,
    })).resolves.toBe(false);
    await expect(t.query(operationalState.isSecondaryOrderPollingLeaseCurrent, {
      scopeKey: scopeArgs.scopeKey,
      configurationVersion: firstClaim.scopes[0].configurationVersion,
      leaseOwner: 'worker-a',
      now: 108,
    })).resolves.toBe(true);
    await expect(t.mutation(operationalState.releaseSecondaryOrderPollingLease, {
      scopeKey: scopeArgs.scopeKey, leaseOwner: 'worker-a', now: 109,
    })).resolves.toBe(true);
  });

  it('preserves the successful poll boundary across failures and rejects identity conflicts before patching', async () => {
    const t = makeTestBackend();
    const seed = await configureAndBeginSeed(t);
    await t.mutation(operationalState.finishSecondaryOrderWatermarkSeed, {
      scopeKey: seed.scopeKey,
      configurationVersion: seed.configurationVersion,
      seedGeneration: seed.seedGeneration,
      salesforceAccountId: seed.salesforceAccountId,
      slackUserId: seed.slackUserId,
      watermark: orderWatermark(older),
      observedOrderCount: 1,
      now: 102,
    });
    await t.mutation(operationalState.enableSeededSecondaryOrderPollingScope, { scopeKey: scopeArgs.scopeKey, now: 103 });
    const claim = await t.mutation(operationalState.claimEnabledSecondaryOrderPollingScopes, {
      now: 104, leaseMs: 5_000, leaseOwner: 'worker-a', limit: 25,
    });
    const leased = claim.scopes[0];
    await t.mutation(operationalState.recordSecondaryOrderPollResult, {
      scopeKey: leased.scopeKey,
      configurationVersion: leased.configurationVersion,
      leaseOwner: leased.pollLeaseOwner,
      salesforceAccountId: leased.salesforceAccountId,
      slackUserId: leased.slackUserId,
      status: 'success',
      watermark: orderWatermark(newer),
      now: 105,
    });
    await t.mutation(operationalState.recordSecondaryOrderPollResult, {
      scopeKey: leased.scopeKey,
      configurationVersion: leased.configurationVersion,
      leaseOwner: leased.pollLeaseOwner,
      salesforceAccountId: leased.salesforceAccountId,
      slackUserId: leased.slackUserId,
      status: 'failure',
      failureCode: 'SALESFORCE_READ_FAILED',
      now: 106,
    });
    await expect(t.mutation(operationalState.recordSecondaryOrderPollResult, {
      scopeKey: leased.scopeKey,
      configurationVersion: leased.configurationVersion,
      leaseOwner: leased.pollLeaseOwner,
      salesforceAccountId: 'WRONG_ACCOUNT',
      slackUserId: leased.slackUserId,
      status: 'failure',
      failureCode: 'SHOULD_NOT_PATCH',
      now: 107,
    })).resolves.toEqual({ updated: false, reason: 'lease_or_scope_changed' });

    await expect(t.query(operationalState.getSecondaryOrderWatermark, { scopeKey: scopeArgs.scopeKey })).resolves.toMatchObject({
      lastOrderWatermark: orderWatermark(newer),
      lastSuccessfulPollAt: 105,
      lastFailureCode: 'SALESFORCE_READ_FAILED',
      lastFailureAt: 106,
    });
    await expect(t.mutation(operationalState.disableSecondaryOrderPollingScope, { scopeKey: scopeArgs.scopeKey, now: 108 })).resolves.toBe(true);
    await expect(t.mutation(operationalState.enableSeededSecondaryOrderPollingScope, { scopeKey: scopeArgs.scopeKey, now: 109 })).resolves.toBe(true);
  });

  it('makes notification delivery reservations durable and terminal', async () => {
    const t = makeTestBackend();
    const args = { scopeKey: scopeArgs.scopeKey, salesforceOrderId: newer.orderId, orderWatermark: orderWatermark(newer) };
    await expect(t.mutation(operationalState.beginSecondaryOrderNotification, { ...args, now: 100 }))
      .resolves.toEqual({ acquired: true, status: 'processing' });
    await expect(t.mutation(operationalState.beginSecondaryOrderNotification, { ...args, now: 101 }))
      .resolves.toEqual({ acquired: false, status: 'processing' });
    await expect(t.mutation(operationalState.recordSecondaryOrderNotification, { ...args, status: 'sent', now: 102 }))
      .resolves.toMatchObject({ recorded: true, status: 'sent' });
    await expect(t.mutation(operationalState.recordSecondaryOrderNotification, {
      ...args, status: 'failed', now: 103, failureCode: 'LATE_FAILURE',
    })).resolves.toMatchObject({ recorded: false, status: 'sent' });
  });

  it('requires an explicit evidence note to resolve an ambiguous notification without replay', async () => {
    const t = makeTestBackend();
    const args = { scopeKey: scopeArgs.scopeKey, salesforceOrderId: older.orderId, orderWatermark: orderWatermark(older) };
    await t.mutation(operationalState.beginSecondaryOrderNotification, { ...args, now: 100 });
    await expect(t.mutation(operationalState.resolveSecondaryOrderNotification, {
      scopeKey: args.scopeKey, salesforceOrderId: args.salesforceOrderId, resolution: 'skipped', resolutionNote: '   ', now: 101,
    })).resolves.toEqual({ resolved: false, status: 'processing' });
    await expect(t.mutation(operationalState.resolveSecondaryOrderNotification, {
      scopeKey: args.scopeKey,
      salesforceOrderId: args.salesforceOrderId,
      resolution: 'skipped',
      resolutionNote: 'Operator confirmed no Slack message is required.',
      now: 102,
    })).resolves.toEqual({ resolved: true, status: 'skipped' });
    await expect(t.mutation(operationalState.beginSecondaryOrderNotification, { ...args, now: 103 }))
      .resolves.toEqual({ acquired: false, status: 'skipped' });
  });
});
