import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { internalActionGeneric } from 'convex/server';
import { v } from 'convex/values';
import schema from '../../convex/schema';
import { internal } from '../../convex/_generated/api';

const operationalState = (internal as any).operationalState;

const fakeReminderDelivery = internalActionGeneric({
  args: { salesforceOrderId: v.string(), dueAt: v.number() },
  handler: async (_ctx, args) => ({ delivered: args.salesforceOrderId, dueAt: args.dueAt }),
});

const fakeGrnFollowupCheck = internalActionGeneric({
  args: { followupKey: v.string(), dueAt: v.number() },
  handler: async (_ctx, args) => ({ followupKey: args.followupKey, dueAt: args.dueAt }),
});

function makeTestBackend() {
  return convexTest(schema, {
    '_generated/api': async () => ({}),
    operationalState: () => import('../../convex/operationalState'),
    reminders: async () => ({ deliver: fakeReminderDelivery }),
    grnFollowups: async () => ({ check: fakeGrnFollowupCheck }),
  });
}

describe('Convex operational state', () => {
  it('atomically grants an idempotency key to only one concurrent caller', async () => {
    const t = makeTestBackend();
    const args = { key: 'create-order:stable-request-id', now: 100, expiresAt: 86_400_100 };

    const results = await Promise.all([
      t.mutation(operationalState.acquireIdempotency, args),
      t.mutation(operationalState.acquireIdempotency, args),
    ]);

    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(await t.query(operationalState.getIdempotencyStatus, { key: args.key, now: 101 })).toBe('processing');
  });

  it('does not silently reacquire a failed idempotency key', async () => {
    const t = makeTestBackend();
    await t.mutation(operationalState.acquireIdempotency, { key: 'create-return:1', now: 100, expiresAt: 200 });
    await t.mutation(operationalState.failIdempotency, { key: 'create-return:1', now: 110, errorCode: 'NETWORK_AMBIGUOUS' });

    await expect(t.mutation(operationalState.acquireIdempotency, { key: 'create-return:1', now: 120, expiresAt: 220 }))
      .resolves.toEqual({ acquired: false, status: 'failed' });
  });

  it('does not let a delayed failure overwrite a completed idempotency result', async () => {
    const t = makeTestBackend();
    await t.mutation(operationalState.acquireIdempotency, { key: 'notify:1', now: 100, expiresAt: 200 });
    await expect(t.mutation(operationalState.completeIdempotency, { key: 'notify:1', now: 101, resultReference: 'sent' })).resolves.toBe(true);
    await expect(t.mutation(operationalState.failIdempotency, { key: 'notify:1', now: 102, errorCode: 'LATE_FAILURE' })).resolves.toBe(false);
    await expect(t.query(operationalState.getIdempotencyStatus, { key: 'notify:1', now: 103 })).resolves.toBe('completed');
  });

  it('enforces interaction state ownership and expiry', async () => {
    const t = makeTestBackend();
    await t.mutation(operationalState.saveInteractionState, {
      key: 'view:abc', teamId: 'T1', userId: 'U1', channelId: 'C1', flowKind: 'primary-order', state: { step: 1 }, now: 100, expiresAt: 200,
    });

    await expect(t.query(operationalState.getActiveInteractionState, { key: 'view:abc', teamId: 'T1', userId: 'U1', now: 150 }))
      .resolves.toMatchObject({ channelId: 'C1', state: { step: 1 } });
    await expect(t.query(operationalState.getActiveInteractionState, { key: 'view:abc', teamId: 'T1', userId: 'U2', now: 150 })).resolves.toBeNull();
    await expect(t.mutation(operationalState.saveInteractionState, {
      key: 'view:abc', teamId: 'T1', userId: 'U2', channelId: 'C2', flowKind: 'primary-order', state: { step: 99 }, now: 151, expiresAt: 250,
    })).resolves.toBeNull();
    await expect(t.query(operationalState.getActiveInteractionState, { key: 'view:abc', teamId: 'T1', userId: 'U1', now: 152 }))
      .resolves.toMatchObject({ channelId: 'C1', state: { step: 1 } });
    await expect(t.query(operationalState.getActiveInteractionState, { key: 'view:abc', teamId: 'T1', userId: 'U1', now: 200 })).resolves.toBeNull();
  });

  it('applies App Home publish suppression atomically per team and user', async () => {
    const t = makeTestBackend();
    const args = { teamId: 'T1', userId: 'U1', suppressionMs: 5_000, expiresAt: 60_000 };
    await expect(t.mutation(operationalState.acquireAppHomePublish, { ...args, now: 100 })).resolves.toBe(true);
    await expect(t.mutation(operationalState.acquireAppHomePublish, { ...args, now: 5_099 })).resolves.toBe(false);
    await expect(t.mutation(operationalState.acquireAppHomePublish, { ...args, now: 5_100 })).resolves.toBe(true);
  });

  it('cleans expired operational state in bounded batches', async () => {
    const t = makeTestBackend();
    await t.mutation(operationalState.acquireIdempotency, { key: 'expired', now: 0, expiresAt: 10 });
    await t.mutation(operationalState.acquireIdempotency, { key: 'active', now: 0, expiresAt: 1_000 });

    await expect(t.mutation(operationalState.cleanupExpired, { now: 10, limit: 10 })).resolves.toBe(1);
    await expect(t.query(operationalState.getIdempotencyStatus, { key: 'expired', now: 10 })).resolves.toBeNull();
    await expect(t.query(operationalState.getIdempotencyStatus, { key: 'active', now: 10 })).resolves.toBe('processing');
  });

  it('tracks integration failures and resets the consecutive count after recovery', async () => {
    const t = makeTestBackend();
    await t.mutation(operationalState.recordIntegrationStatus, {
      component: 'secondaryOrderPoller', outcome: 'failure', now: 100, errorCode: 'SALESFORCE_READ_FAILED',
    });
    await t.mutation(operationalState.recordIntegrationStatus, {
      component: 'secondaryOrderPoller', outcome: 'failure', now: 101, errorCode: 'SALESFORCE_READ_FAILED',
    });
    await expect(t.query(operationalState.getIntegrationStatus, { component: 'secondaryOrderPoller' })).resolves.toMatchObject({
      status: 'degraded', consecutiveFailureCount: 2, lastFailureAt: 101, errorCode: 'SALESFORCE_READ_FAILED',
    });
    await t.mutation(operationalState.recordIntegrationStatus, {
      component: 'secondaryOrderPoller', outcome: 'success', now: 102,
    });
    await expect(t.query(operationalState.getIntegrationStatus, { component: 'secondaryOrderPoller' })).resolves.toMatchObject({
      status: 'healthy', consecutiveFailureCount: 0, lastSuccessAt: 102,
    });
  });

  it('advances reminder claims durably and preserves the last successful delivery across a later failure', async () => {
    const t = makeTestBackend();
    const base = Date.now() + 60_000;
    await t.mutation(operationalState.upsertPartialOrderReminder, {
      salesforceOrderId: '801',
      salesforceAccountId: '001',
      teamId: 'T1',
      slackUserId: 'U1',
      orderNumber: '0001',
      retailerCustomer: 'Retailer A',
      pendingItemCount: 2,
      nextReminderAt: base + 100,
      now: base,
      expiresAt: base + 10_000,
    });
    await expect(t.mutation(operationalState.claimPartialOrderReminder, {
      salesforceOrderId: '801', dueAt: base + 100, nextReminderAt: base + 200, now: base + 100,
    })).resolves.toMatchObject({ attemptCount: 0, nextReminderAt: base + 100 });
    await t.mutation(operationalState.recordPartialOrderReminderResult, {
      salesforceOrderId: '801', sentAt: base + 101, now: base + 101,
    });
    await t.mutation(operationalState.claimPartialOrderReminder, {
      salesforceOrderId: '801', dueAt: base + 200, nextReminderAt: base + 300, now: base + 200,
    });
    await t.mutation(operationalState.recordPartialOrderReminderResult, {
      salesforceOrderId: '801', now: base + 201, errorCode: 'SLACK_DELIVERY_FAILED',
    });

    await expect(t.query(operationalState.getPartialOrderReminder, { salesforceOrderId: '801' })).resolves.toMatchObject({
      attemptCount: 2,
      nextReminderAt: base + 300,
      lastSentAt: base + 101,
      lastFailureAt: base + 201,
      lastFailureCode: 'SLACK_DELIVERY_FAILED',
    });
    await expect(t.query(operationalState.getIntegrationStatus, { component: 'reminders' })).resolves.toMatchObject({
      status: 'degraded', consecutiveFailureCount: 1, lastSuccessAt: base + 101, lastFailureAt: base + 201,
    });
  });

  it('re-enqueues only overdue active reminder boundaries in a bounded safety pass', async () => {
    const t = makeTestBackend();
    const now = Date.now();
    const reminder = (salesforceOrderId: string, active: boolean, nextReminderAt: number) => ({
      salesforceOrderId,
      salesforceAccountId: '001',
      teamId: 'T1',
      slackUserId: 'U1',
      orderNumber: salesforceOrderId,
      retailerCustomer: 'Retailer A',
      pendingItemCount: active ? 1 : 0,
      active,
      nextReminderAt,
      attemptCount: 0,
      updatedAt: now - 1_000,
      expiresAt: now + 60_000,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('partialOrderReminders', reminder('overdue-active', true, now - 100));
      await ctx.db.insert('partialOrderReminders', reminder('future-active', true, now + 30_000));
      await ctx.db.insert('partialOrderReminders', reminder('overdue-inactive', false, now - 100));
    });

    await expect(t.mutation(operationalState.reconcileOverduePartialOrderReminders, { now, limit: 10 }))
      .resolves.toEqual({ rescheduled: 1, moreMayRemain: false });
    await t.finishInProgressScheduledFunctions();
  });

  it('schedules and claims only the current scoped GRN follow-up boundary', async () => {
    const t = makeTestBackend();
    const now = Date.now();
    const context = {
      slackUserId: 'U1', slackTeamId: 'T1', slackEnterpriseId: null, slackEmail: 'user@example.com',
      salesforceAccountId: '001A', accountName: 'Distributor A', distributorCode: null,
      mappingSource: 'AccountEmail' as const, resolvedAt: '2026-08-09T00:00:00.000Z',
      isActive: true, accountType: 'Partner', businessType: 'Distributor',
    };
    const scheduled = await t.mutation(operationalState.scheduleGRNFollowup, {
      teamId: 'T1', userId: 'U1', orderId: 'SO1', dispatchId: 'D1', dispatchName: 'Dispatch 1', invoiceId: 'INV-1', context, now,
    });
    await expect(t.mutation(operationalState.claimGRNFollowup, {
      followupKey: scheduled.followupKey, dueAt: scheduled.dueAt - 1, now: scheduled.dueAt,
    })).resolves.toBeNull();
    await expect(t.mutation(operationalState.claimGRNFollowup, {
      followupKey: scheduled.followupKey, dueAt: scheduled.dueAt, now: scheduled.dueAt,
    })).resolves.toMatchObject({ orderId: 'SO1', status: 'pending', attempt: 0, context: { salesforceAccountId: '001A' } });
    await expect(t.mutation(operationalState.rescheduleGRNFollowup, {
      followupKey: scheduled.followupKey, now: scheduled.dueAt + 1,
    })).resolves.toMatchObject({ attempt: 1 });
  });
});
