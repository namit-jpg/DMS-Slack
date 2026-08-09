import { anyApi, internalMutationGeneric, internalQueryGeneric } from 'convex/server';
import { v } from 'convex/values';

const idempotencyStatus = v.union(v.literal('processing'), v.literal('completed'), v.literal('failed'));
const integrationComponent = v.union(
  v.literal('slackIngress'),
  v.literal('salesforce'),
  v.literal('reminders'),
  v.literal('secondaryOrderPoller'),
);
const integrationOutcome = v.union(v.literal('not_configured'), v.literal('success'), v.literal('failure'));

async function writeIntegrationStatus(
  db: any,
  args: {
    component: 'slackIngress' | 'salesforce' | 'reminders' | 'secondaryOrderPoller';
    outcome: 'not_configured' | 'success' | 'failure';
    now: number;
    errorCode?: string;
  },
) {
  const existing = await db.query('integrationStatus').withIndex('by_component', (q: any) => q.eq('component', args.component)).unique();
  const value = args.outcome === 'success'
    ? {
        status: 'healthy' as const,
        lastAttemptAt: args.now,
        lastSuccessAt: args.now,
        lastFailureAt: existing?.lastFailureAt,
        consecutiveFailureCount: 0,
        errorCode: undefined,
        updatedAt: args.now,
      }
    : args.outcome === 'failure'
      ? {
          status: 'degraded' as const,
          lastAttemptAt: args.now,
          lastSuccessAt: existing?.lastSuccessAt,
          lastFailureAt: args.now,
          consecutiveFailureCount: (existing?.consecutiveFailureCount ?? 0) + 1,
          errorCode: args.errorCode ?? 'UNKNOWN_FAILURE',
          updatedAt: args.now,
        }
      : {
          status: 'not_configured' as const,
          lastAttemptAt: existing?.lastAttemptAt,
          lastSuccessAt: existing?.lastSuccessAt,
          lastFailureAt: existing?.lastFailureAt,
          consecutiveFailureCount: existing?.consecutiveFailureCount ?? 0,
          errorCode: undefined,
          updatedAt: args.now,
        };

  if (existing) {
    await db.patch(existing._id, value);
    return existing._id;
  }
  return db.insert('integrationStatus', { component: args.component, ...value });
}

export const acquireIdempotency = internalMutationGeneric({
  args: { key: v.string(), now: v.number(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('idempotencyKeys').withIndex('by_key', (q) => q.eq('key', args.key)).unique();
    if (existing && existing.expiresAt > args.now) {
      return { acquired: false, status: existing.status };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: 'processing',
        resultReference: undefined,
        errorCode: undefined,
        updatedAt: args.now,
        expiresAt: args.expiresAt,
      });
    } else {
      await ctx.db.insert('idempotencyKeys', {
        key: args.key,
        status: 'processing',
        createdAt: args.now,
        updatedAt: args.now,
        expiresAt: args.expiresAt,
      });
    }
    return { acquired: true, status: 'processing' as const };
  },
});

export const acceptSlackIngress = internalMutationGeneric({
  args: {
    dedupeKey: v.string(),
    kind: v.union(v.literal('command'), v.literal('event'), v.literal('action')),
    sourceTeamId: v.optional(v.string()), teamId: v.string(), userId: v.string(), handlerKey: v.string(), payload: v.any(),
    responseUrl: v.optional(v.string()), responseUrlExpiresAt: v.optional(v.number()),
    receivedAt: v.number(), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('slackIngress').withIndex('by_dedupe_key', (q) => q.eq('dedupeKey', args.dedupeKey)).unique();
    if (existing && existing.expiresAt > args.receivedAt) {
      await writeIntegrationStatus(ctx.db, { component: 'slackIngress', outcome: 'success', now: args.receivedAt });
      return { accepted: false, status: existing.status };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        kind: args.kind, sourceTeamId: args.sourceTeamId, teamId: args.teamId, userId: args.userId, handlerKey: args.handlerKey, payload: args.payload,
        responseUrl: args.responseUrl, responseUrlExpiresAt: args.responseUrlExpiresAt,
        status: 'accepted', attemptCount: 0, receivedAt: args.receivedAt, updatedAt: args.receivedAt, expiresAt: args.expiresAt, errorCode: undefined,
      });
    } else {
      await ctx.db.insert('slackIngress', { ...args, status: 'accepted', attemptCount: 0, updatedAt: args.receivedAt });
    }
    await ctx.scheduler.runAfter(0, anyApi.slackDispatch.processReceipt, { dedupeKey: args.dedupeKey });
    await writeIntegrationStatus(ctx.db, { component: 'slackIngress', outcome: 'success', now: args.receivedAt });
    return { accepted: true, status: 'accepted' as const };
  },
});

export const getSlackIngress = internalQueryGeneric({
  args: { dedupeKey: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const receipt = await ctx.db.query('slackIngress').withIndex('by_dedupe_key', (q) => q.eq('dedupeKey', args.dedupeKey)).unique();
    return receipt && receipt.expiresAt > args.now ? receipt : null;
  },
});

export const markSlackIngressProcessing = internalMutationGeneric({
  args: { dedupeKey: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const receipt = await ctx.db.query('slackIngress').withIndex('by_dedupe_key', (q) => q.eq('dedupeKey', args.dedupeKey)).unique();
    if (!receipt || receipt.expiresAt <= args.now || receipt.status !== 'accepted') return null;
    await ctx.db.patch(receipt._id, { status: 'processing', attemptCount: receipt.attemptCount + 1, updatedAt: args.now });
    return { ...receipt, status: 'processing' as const, attemptCount: receipt.attemptCount + 1 };
  },
});

export const markSlackIngressTerminal = internalMutationGeneric({
  args: { dedupeKey: v.string(), status: v.union(v.literal('completed'), v.literal('failed')), now: v.number(), errorCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const receipt = await ctx.db.query('slackIngress').withIndex('by_dedupe_key', (q) => q.eq('dedupeKey', args.dedupeKey)).unique();
    if (!receipt || receipt.status !== 'processing') return false;
    await ctx.db.patch(receipt._id, { status: args.status, errorCode: args.errorCode, updatedAt: args.now, responseUrl: undefined, responseUrlExpiresAt: undefined });
    await writeIntegrationStatus(ctx.db, {
      component: 'slackIngress',
      outcome: args.status === 'completed' ? 'success' : 'failure',
      now: args.now,
      errorCode: args.errorCode,
    });
    return true;
  },
});

export const completeIdempotency = internalMutationGeneric({
  args: { key: v.string(), now: v.number(), resultReference: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('idempotencyKeys').withIndex('by_key', (q) => q.eq('key', args.key)).unique();
    if (!existing || existing.status !== 'processing') return false;
    await ctx.db.patch(existing._id, {
      status: 'completed',
      resultReference: args.resultReference,
      errorCode: undefined,
      updatedAt: args.now,
    });
    return true;
  },
});

export const failIdempotency = internalMutationGeneric({
  args: { key: v.string(), now: v.number(), errorCode: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('idempotencyKeys').withIndex('by_key', (q) => q.eq('key', args.key)).unique();
    if (!existing || existing.status !== 'processing') return false;
    await ctx.db.patch(existing._id, { status: 'failed', errorCode: args.errorCode, updatedAt: args.now });
    return true;
  },
});

export const getActiveInteractionState = internalQueryGeneric({
  args: { key: v.string(), teamId: v.string(), userId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const state = await ctx.db.query('interactionStates').withIndex('by_key', (q) => q.eq('key', args.key)).unique();
    if (!state || state.expiresAt <= args.now || state.teamId !== args.teamId || state.userId !== args.userId) return null;
    return state;
  },
});

export const saveInteractionState = internalMutationGeneric({
  args: {
    key: v.string(), teamId: v.string(), userId: v.string(), channelId: v.string(), flowKind: v.string(), state: v.any(), now: v.number(), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('interactionStates').withIndex('by_key', (q) => q.eq('key', args.key)).unique();
    if (existing) {
      if (existing.teamId !== args.teamId || existing.userId !== args.userId) return null;
      await ctx.db.patch(existing._id, { channelId: args.channelId, flowKind: args.flowKind, state: args.state, updatedAt: args.now, expiresAt: args.expiresAt });
      return existing._id;
    }
    return ctx.db.insert('interactionStates', {
      key: args.key,
      teamId: args.teamId,
      userId: args.userId,
      channelId: args.channelId,
      flowKind: args.flowKind,
      state: args.state,
      createdAt: args.now,
      updatedAt: args.now,
      expiresAt: args.expiresAt,
    });
  },
});

export const putOrderBuilder = internalMutationGeneric({
  args: {
    teamId: v.string(), userId: v.string(), selected: v.array(v.object({ productId: v.string(), quantity: v.number(), schemeDiscount: v.optional(v.number()) })),
    selectedCreditNoteIds: v.optional(v.array(v.string())), quote: v.optional(v.any()), now: v.number(), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('orderBuilders').withIndex('by_team_user', (q: any) => q.eq('teamId', args.teamId).eq('userId', args.userId)).unique();
    const value = { selected: args.selected, selectedCreditNoteIds: args.selectedCreditNoteIds, quote: args.quote, updatedAt: args.now, expiresAt: args.expiresAt };
    if (existing) { await ctx.db.patch(existing._id, value); return existing._id; }
    return ctx.db.insert('orderBuilders', { teamId: args.teamId, userId: args.userId, ...value });
  },
});

export const getActiveOrderBuilder = internalQueryGeneric({
  args: { teamId: v.string(), userId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const state = await ctx.db.query('orderBuilders').withIndex('by_team_user', (q: any) => q.eq('teamId', args.teamId).eq('userId', args.userId)).unique();
    return state && state.expiresAt > args.now ? state : null;
  },
});

export const clearOrderBuilder = internalMutationGeneric({
  args: { teamId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const state = await ctx.db.query('orderBuilders').withIndex('by_team_user', (q: any) => q.eq('teamId', args.teamId).eq('userId', args.userId)).unique();
    if (!state) return false;
    await ctx.db.delete(state._id);
    return true;
  },
});

export const getPendingArsChange = internalQueryGeneric({
  args: { teamId: v.string(), channelId: v.string(), messageTs: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const change = await ctx.db.query('pendingArsChanges').withIndex('by_message_ts', (q: any) => q.eq('teamId', args.teamId).eq('channelId', args.channelId).eq('messageTs', args.messageTs)).unique();
    if (!change || change.status !== 'pending' || change.expiresAt <= args.now) return null;
    return change;
  },
});

export const resolvePendingArsChange = internalMutationGeneric({
  args: { teamId: v.string(), channelId: v.string(), messageTs: v.string(), status: v.union(v.literal('approved'), v.literal('rejected')), now: v.number() },
  handler: async (ctx, args) => {
    const change = await ctx.db.query('pendingArsChanges').withIndex('by_message_ts', (q: any) => q.eq('teamId', args.teamId).eq('channelId', args.channelId).eq('messageTs', args.messageTs)).unique();
    if (!change || change.status !== 'pending' || change.expiresAt <= args.now) return null;
    await ctx.db.patch(change._id, { status: args.status, resolvedAt: args.now });
    return change;
  },
});

export const savePendingArsChange = internalMutationGeneric({
  args: {
    teamId: v.string(), channelId: v.string(), messageTs: v.string(), requestingUserId: v.string(), requestingUserName: v.string(),
    salesforceAccountId: v.string(), accountName: v.string(),
    changes: v.array(v.object({ productId: v.string(), productName: v.string(), oldMin: v.number(), newMin: v.number(), oldMax: v.number(), newMax: v.number() })),
    now: v.number(), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('pendingArsChanges').withIndex('by_message_ts', (q: any) => q.eq('teamId', args.teamId).eq('channelId', args.channelId).eq('messageTs', args.messageTs)).unique();
    if (existing && (
      existing.requestingUserId !== args.requestingUserId
      || existing.salesforceAccountId !== args.salesforceAccountId
    )) return null;
    // A delayed retry must never reopen an already resolved approval.
    if (existing && existing.status !== 'pending') return existing._id;
    const value = {
      requestingUserId: args.requestingUserId,
      requestingUserName: args.requestingUserName,
      salesforceAccountId: args.salesforceAccountId,
      accountName: args.accountName,
      changes: args.changes,
      status: 'pending' as const,
      expiresAt: args.expiresAt,
    };
    if (existing) { await ctx.db.patch(existing._id, value); return existing._id; }
    return ctx.db.insert('pendingArsChanges', {
      teamId: args.teamId,
      channelId: args.channelId,
      messageTs: args.messageTs,
      ...value,
      createdAt: args.now,
    });
  },
});

export const acquireAppHomePublish = internalMutationGeneric({
  args: { teamId: v.string(), userId: v.string(), now: v.number(), suppressionMs: v.number(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const current = await ctx.db.query('appHomePublishes').withIndex('by_team_user', (q: any) => q.eq('teamId', args.teamId).eq('userId', args.userId)).unique();
    if (current && current.lastPublishedAt + args.suppressionMs > args.now) return false;
    if (current) await ctx.db.patch(current._id, { lastPublishedAt: args.now, expiresAt: args.expiresAt });
    else await ctx.db.insert('appHomePublishes', { teamId: args.teamId, userId: args.userId, lastPublishedAt: args.now, expiresAt: args.expiresAt });
    return true;
  },
});

export const upsertPartialOrderReminder = internalMutationGeneric({
  args: {
    salesforceOrderId: v.string(), salesforceAccountId: v.string(), teamId: v.string(), slackUserId: v.string(), orderNumber: v.string(), retailerCustomer: v.string(),
    pendingItemCount: v.number(), nextReminderAt: v.number(), now: v.number(), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('partialOrderReminders').withIndex('by_order_id', (q) => q.eq('salesforceOrderId', args.salesforceOrderId)).unique();
    const value = {
      salesforceAccountId: args.salesforceAccountId, teamId: args.teamId, slackUserId: args.slackUserId, orderNumber: args.orderNumber, retailerCustomer: args.retailerCustomer,
      pendingItemCount: args.pendingItemCount, active: args.pendingItemCount > 0, nextReminderAt: args.nextReminderAt, updatedAt: args.now, expiresAt: args.expiresAt,
    };
    let id;
    if (existing) {
      await ctx.db.patch(existing._id, value);
      id = existing._id;
    } else {
      id = await ctx.db.insert('partialOrderReminders', { salesforceOrderId: args.salesforceOrderId, ...value, attemptCount: 0 });
    }
    if (value.active) {
      await ctx.scheduler.runAt(args.nextReminderAt, anyApi.reminders.deliver, {
        salesforceOrderId: args.salesforceOrderId,
        dueAt: args.nextReminderAt,
      });
    }
    return id;
  },
});

export const getPartialOrderReminder = internalQueryGeneric({
  args: { salesforceOrderId: v.string() },
  handler: async (ctx, args) => ctx.db.query('partialOrderReminders').withIndex('by_order_id', (q) => q.eq('salesforceOrderId', args.salesforceOrderId)).unique(),
});

export const claimPartialOrderReminder = internalMutationGeneric({
  args: { salesforceOrderId: v.string(), dueAt: v.number(), nextReminderAt: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.query('partialOrderReminders').withIndex('by_order_id', (q) => q.eq('salesforceOrderId', args.salesforceOrderId)).unique();
    if (!reminder || !reminder.active || reminder.nextReminderAt !== args.dueAt) return null;
    await ctx.db.patch(reminder._id, { nextReminderAt: args.nextReminderAt, attemptCount: reminder.attemptCount + 1, updatedAt: args.now });
    // Schedule the next claim in the same transaction as advancing the due
    // boundary so an action crash cannot strand an active reminder.
    await ctx.scheduler.runAt(args.nextReminderAt, anyApi.reminders.deliver, {
      salesforceOrderId: args.salesforceOrderId,
      dueAt: args.nextReminderAt,
    });
    return reminder;
  },
});

export const recordPartialOrderReminderResult = internalMutationGeneric({
  args: { salesforceOrderId: v.string(), sentAt: v.optional(v.number()), now: v.number(), errorCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.query('partialOrderReminders').withIndex('by_order_id', (q) => q.eq('salesforceOrderId', args.salesforceOrderId)).unique();
    if (!reminder) return false;
    if (args.sentAt !== undefined) {
      await ctx.db.patch(reminder._id, {
        lastSentAt: args.sentAt,
        lastFailureCode: undefined,
        lastFailureAt: undefined,
        updatedAt: args.now,
      });
      await writeIntegrationStatus(ctx.db, { component: 'reminders', outcome: 'success', now: args.now });
    } else {
      await ctx.db.patch(reminder._id, {
        lastFailureCode: args.errorCode ?? 'UNKNOWN_FAILURE',
        lastFailureAt: args.now,
        updatedAt: args.now,
      });
      await writeIntegrationStatus(ctx.db, {
        component: 'reminders', outcome: 'failure', now: args.now, errorCode: args.errorCode,
      });
    }
    return true;
  },
});

export const deactivatePartialOrderReminder = internalMutationGeneric({
  args: { salesforceOrderId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.query('partialOrderReminders').withIndex('by_order_id', (q) => q.eq('salesforceOrderId', args.salesforceOrderId)).unique();
    if (!reminder) return false;
    await ctx.db.patch(reminder._id, { active: false, pendingItemCount: 0, updatedAt: args.now });
    return true;
  },
});

/**
 * Safety net for Convex's at-most-once scheduled actions. Duplicate schedules
 * are harmless because `claimPartialOrderReminder` accepts only the exact
 * current due boundary.
 */
export const reconcileOverduePartialOrderReminders = internalMutationGeneric({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit, 1), 100);
    const overdue = await ctx.db.query('partialOrderReminders').withIndex('by_active_next_reminder', (q: any) => q
      .eq('active', true)
      .lte('nextReminderAt', args.now)).take(limit);
    for (const reminder of overdue) {
      await ctx.scheduler.runAfter(0, anyApi.reminders.deliver, {
        salesforceOrderId: reminder.salesforceOrderId,
        dueAt: reminder.nextReminderAt,
      });
    }
    return { rescheduled: overdue.length, moreMayRemain: overdue.length === limit };
  },
});

/**
 * Persist and schedule the short GRN-read follow-up separately from the
 * Slack-dispatch action. Repeating an interaction supersedes the earlier
 * follow-up by moving its exact due boundary; stale schedules then no-op.
 */
export const scheduleGRNFollowup = internalMutationGeneric({
  args: {
    teamId: v.string(), userId: v.string(), orderId: v.string(), dispatchId: v.string(), dispatchName: v.string(), invoiceId: v.optional(v.string()),
    context: v.object({
      slackUserId: v.string(), slackTeamId: v.string(), slackEnterpriseId: v.union(v.string(), v.null()), slackEmail: v.string(),
      salesforceAccountId: v.string(), accountName: v.string(), distributorCode: v.union(v.string(), v.null()),
      mappingSource: v.union(v.literal('AccountEmail'), v.literal('ContactEmail'), v.literal('PersonAccountEmail'), v.literal('DistributorObject')),
      resolvedAt: v.string(), isActive: v.boolean(), accountType: v.string(), businessType: v.string(),
    }),
    responseUrl: v.optional(v.string()), responseUrlExpiresAt: v.optional(v.number()), now: v.number(),
  },
  handler: async (ctx, args) => {
    const followupKey = `${args.teamId}:${args.userId}:${args.dispatchId}`;
    const nextCheckAt = args.now + 1_000;
    const expiresAt = args.now + 15 * 60 * 1_000;
    const existing = await ctx.db.query('grnFollowups').withIndex('by_key', (q: any) => q.eq('followupKey', followupKey)).unique();
    const value = {
      teamId: args.teamId, userId: args.userId, orderId: args.orderId, dispatchName: args.dispatchName, invoiceId: args.invoiceId,
      context: args.context, responseUrl: args.responseUrl, responseUrlExpiresAt: args.responseUrlExpiresAt,
      status: 'pending' as const, attempt: 0, nextCheckAt, lastErrorCode: undefined, updatedAt: args.now, expiresAt,
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert('grnFollowups', { followupKey, ...value, createdAt: args.now });
    await ctx.scheduler.runAt(nextCheckAt, anyApi.grnFollowups.check, { followupKey, dueAt: nextCheckAt });
    return { followupKey, dueAt: nextCheckAt };
  },
});

/** Claim only the exact schedule boundary; duplicate or superseded jobs exit. */
export const claimGRNFollowup = internalMutationGeneric({
  args: { followupKey: v.string(), dueAt: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    const followup = await ctx.db.query('grnFollowups').withIndex('by_key', (q: any) => q.eq('followupKey', args.followupKey)).unique();
    if (!followup || followup.expiresAt <= args.now || followup.status !== 'pending' || followup.nextCheckAt !== args.dueAt) return null;
    await ctx.db.patch(followup._id, { status: 'processing', updatedAt: args.now });
    return followup;
  },
});

export const rescheduleGRNFollowup = internalMutationGeneric({
  args: { followupKey: v.string(), now: v.number(), errorCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const followup = await ctx.db.query('grnFollowups').withIndex('by_key', (q: any) => q.eq('followupKey', args.followupKey)).unique();
    if (!followup || followup.status !== 'processing' || followup.expiresAt <= args.now) return null;
    const nextCheckAt = args.now + 1_000;
    await ctx.db.patch(followup._id, {
      status: 'pending', attempt: followup.attempt + 1, nextCheckAt, lastErrorCode: args.errorCode, updatedAt: args.now,
    });
    await ctx.scheduler.runAt(nextCheckAt, anyApi.grnFollowups.check, { followupKey: args.followupKey, dueAt: nextCheckAt });
    return { attempt: followup.attempt + 1, dueAt: nextCheckAt };
  },
});

export const completeGRNFollowup = internalMutationGeneric({
  args: { followupKey: v.string(), status: v.union(v.literal('completed'), v.literal('failed')), now: v.number(), errorCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const followup = await ctx.db.query('grnFollowups').withIndex('by_key', (q: any) => q.eq('followupKey', args.followupKey)).unique();
    if (!followup || followup.status !== 'processing') return false;
    await ctx.db.patch(followup._id, {
      status: args.status, responseUrl: undefined, responseUrlExpiresAt: undefined, lastErrorCode: args.errorCode, updatedAt: args.now,
    });
    return true;
  },
});

export const configureSecondaryOrderPollingScope = internalMutationGeneric({
  args: {
    scopeKey: v.string(), teamId: v.string(), slackUserId: v.string(), salesforceAccountId: v.string(), notificationChannelId: v.string(), now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('secondaryOrderPollingScopes').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    const configurationVersion = (existing?.configurationVersion ?? 0) + 1;
    const seedGeneration = (existing?.seedGeneration ?? 0) + 1;
    const value = {
      teamId: args.teamId,
      slackUserId: args.slackUserId,
      salesforceAccountId: args.salesforceAccountId,
      notificationChannelId: args.notificationChannelId,
      // Scope changes must be reseeded before notifications can resume.
      notificationsEnabled: false,
      configurationVersion,
      seedGeneration,
      watermarkSeededAt: undefined,
      seedObservedOrderCount: undefined,
      pollLeaseOwner: undefined,
      pollLeaseExpiresAt: undefined,
      updatedAt: args.now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return ctx.db.insert('secondaryOrderPollingScopes', { scopeKey: args.scopeKey, ...value, createdAt: args.now });
  },
});

export const listSeedableSecondaryOrderPollingScopes = internalQueryGeneric({
  args: {},
  handler: async (ctx) => ctx.db.query('secondaryOrderPollingScopes').take(500),
});

export const getSecondaryOrderPollingScope = internalQueryGeneric({
  args: { scopeKey: v.string() },
  handler: async (ctx, args) => ctx.db.query('secondaryOrderPollingScopes').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique(),
});

/**
 * Disables a scope before its Salesforce seed read starts and returns a
 * generation-bound snapshot. A slower, older seed can therefore never patch a
 * scope that was reconfigured or reseeded while its network request ran.
 */
export const beginSecondaryOrderWatermarkSeed = internalMutationGeneric({
  args: { scopeKey: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const scope = await ctx.db.query('secondaryOrderPollingScopes').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    if (!scope) return null;
    const seedGeneration = scope.seedGeneration + 1;
    await ctx.db.patch(scope._id, {
      notificationsEnabled: false,
      watermarkSeededAt: undefined,
      seedObservedOrderCount: undefined,
      seedGeneration,
      pollLeaseOwner: undefined,
      pollLeaseExpiresAt: undefined,
      updatedAt: args.now,
    });
    return { ...scope, notificationsEnabled: false, watermarkSeededAt: undefined, seedObservedOrderCount: undefined, seedGeneration };
  },
});

export const finishSecondaryOrderWatermarkSeed = internalMutationGeneric({
  args: {
    scopeKey: v.string(),
    configurationVersion: v.number(),
    seedGeneration: v.number(),
    salesforceAccountId: v.string(),
    slackUserId: v.string(),
    watermark: v.optional(v.string()),
    observedOrderCount: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const scope = await ctx.db.query('secondaryOrderPollingScopes').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    if (!scope) return { updated: false, reason: 'scope_not_found' as const };
    if (
      scope.configurationVersion !== args.configurationVersion
      || scope.seedGeneration !== args.seedGeneration
      || scope.salesforceAccountId !== args.salesforceAccountId
      || scope.slackUserId !== args.slackUserId
    ) return { updated: false, reason: 'scope_changed' as const };

    const current = await ctx.db.query('secondaryOrderWatermarks').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    const value = {
      salesforceAccountId: args.salesforceAccountId,
      slackUserId: args.slackUserId,
      lastSuccessfulPollAt: args.now,
      // `undefined` is meaningful here: a successful empty snapshot clears a
      // stale prior order watermark while watermarkSeededAt proves the seed.
      lastOrderWatermark: args.watermark,
      lastFailureCode: undefined,
      lastFailureAt: undefined,
      updatedAt: args.now,
    };
    if (current) await ctx.db.patch(current._id, value);
    else await ctx.db.insert('secondaryOrderWatermarks', { scopeKey: args.scopeKey, ...value });
    await ctx.db.patch(scope._id, {
      notificationsEnabled: false,
      watermarkSeededAt: args.now,
      seedObservedOrderCount: args.observedOrderCount,
      updatedAt: args.now,
    });
    return { updated: true, reason: 'seeded' as const };
  },
});

export const failSecondaryOrderWatermarkSeed = internalMutationGeneric({
  args: {
    scopeKey: v.string(), configurationVersion: v.number(), seedGeneration: v.number(), salesforceAccountId: v.string(), slackUserId: v.string(),
    now: v.number(), failureCode: v.string(),
  },
  handler: async (ctx, args) => {
    const scope = await ctx.db.query('secondaryOrderPollingScopes').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    if (!scope) return { updated: false, reason: 'scope_not_found' as const };
    if (
      scope.configurationVersion !== args.configurationVersion
      || scope.seedGeneration !== args.seedGeneration
      || scope.salesforceAccountId !== args.salesforceAccountId
      || scope.slackUserId !== args.slackUserId
    ) return { updated: false, reason: 'scope_changed' as const };

    const current = await ctx.db.query('secondaryOrderWatermarks').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    const value = {
      salesforceAccountId: args.salesforceAccountId,
      slackUserId: args.slackUserId,
      // Failed work only updates failure evidence. The last successful poll
      // and its known-good watermark remain untouched.
      lastSuccessfulPollAt: current?.lastSuccessfulPollAt,
      lastOrderWatermark: current?.lastOrderWatermark,
      lastFailureCode: args.failureCode,
      lastFailureAt: args.now,
      updatedAt: args.now,
    };
    if (current) await ctx.db.patch(current._id, value);
    else await ctx.db.insert('secondaryOrderWatermarks', { scopeKey: args.scopeKey, ...value });
    return { updated: true, reason: 'failure_recorded' as const };
  },
});

export const enableSeededSecondaryOrderPollingScope = internalMutationGeneric({
  args: { scopeKey: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const scope = await ctx.db.query('secondaryOrderPollingScopes').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    if (!scope || scope.watermarkSeededAt === undefined) return false;
    const watermark = await ctx.db.query('secondaryOrderWatermarks').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    if (!watermark || (watermark.lastSuccessfulPollAt ?? -1) < scope.watermarkSeededAt) return false;
    await ctx.db.patch(scope._id, { notificationsEnabled: true, updatedAt: args.now });
    return true;
  },
});

export const disableSecondaryOrderPollingScope = internalMutationGeneric({
  args: { scopeKey: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const scope = await ctx.db.query('secondaryOrderPollingScopes').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    if (!scope) return false;
    await ctx.db.patch(scope._id, {
      notificationsEnabled: false,
      pollLeaseOwner: undefined,
      pollLeaseExpiresAt: undefined,
      updatedAt: args.now,
    });
    return true;
  },
});

export const claimEnabledSecondaryOrderPollingScopes = internalMutationGeneric({
  args: { now: v.number(), leaseMs: v.number(), leaseOwner: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    const safeLeaseMs = Math.min(Math.max(args.leaseMs, 1_000), 15 * 60 * 1000);
    const safeLimit = Math.min(Math.max(args.limit, 1), 100);
    // Optional index fields have deployment-version-sensitive boundary
    // semantics. Read a bounded enabled set and evaluate missing/expired leases
    // explicitly so a freshly enabled scope is always claimable.
    const enabledScopes = await ctx.db.query('secondaryOrderPollingScopes').withIndex('by_enabled', (q) => q.eq('notificationsEnabled', true)).take(500);
    const scopes = enabledScopes.filter((scope) => (scope.pollLeaseExpiresAt ?? 0) <= args.now);
    const claimed = [];
    for (const scope of scopes) {
      if (claimed.length >= safeLimit) break;
      if (scope.watermarkSeededAt === undefined) continue;
      const pollLeaseExpiresAt = args.now + safeLeaseMs;
      await ctx.db.patch(scope._id, { pollLeaseOwner: args.leaseOwner, pollLeaseExpiresAt, updatedAt: args.now });
      claimed.push({ ...scope, pollLeaseOwner: args.leaseOwner, pollLeaseExpiresAt });
    }
    return { scopes: claimed, enabledScopeCount: enabledScopes.length };
  },
});

export const isSecondaryOrderPollingLeaseCurrent = internalQueryGeneric({
  args: { scopeKey: v.string(), configurationVersion: v.number(), leaseOwner: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const scope = await ctx.db.query('secondaryOrderPollingScopes').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    return Boolean(
      scope
      && scope.notificationsEnabled
      && scope.watermarkSeededAt !== undefined
      && scope.configurationVersion === args.configurationVersion
      && scope.pollLeaseOwner === args.leaseOwner
      && (scope.pollLeaseExpiresAt ?? 0) > args.now,
    );
  },
});

export const releaseSecondaryOrderPollingLease = internalMutationGeneric({
  args: { scopeKey: v.string(), leaseOwner: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const scope = await ctx.db.query('secondaryOrderPollingScopes').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    if (!scope || scope.pollLeaseOwner !== args.leaseOwner) return false;
    await ctx.db.patch(scope._id, { pollLeaseOwner: undefined, pollLeaseExpiresAt: undefined, updatedAt: args.now });
    return true;
  },
});

export const recordSecondaryOrderPollResult = internalMutationGeneric({
  args: {
    scopeKey: v.string(), configurationVersion: v.number(), leaseOwner: v.string(), salesforceAccountId: v.string(), slackUserId: v.string(),
    status: v.union(v.literal('success'), v.literal('failure')), watermark: v.optional(v.string()), now: v.number(), failureCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await ctx.db.query('secondaryOrderPollingScopes').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    if (!scope) return { updated: false, reason: 'scope_not_found' as const };
    if (
      scope.configurationVersion !== args.configurationVersion
      || scope.pollLeaseOwner !== args.leaseOwner
      || scope.salesforceAccountId !== args.salesforceAccountId
      || scope.slackUserId !== args.slackUserId
    ) return { updated: false, reason: 'lease_or_scope_changed' as const };

    const current = await ctx.db.query('secondaryOrderWatermarks').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique();
    if (!current) return { updated: false, reason: 'watermark_not_found' as const };
    if (args.status === 'failure') {
      await ctx.db.patch(current._id, {
        lastFailureCode: args.failureCode ?? 'UNKNOWN_FAILURE',
        lastFailureAt: args.now,
        updatedAt: args.now,
      });
      return { updated: true, reason: 'failure_recorded' as const };
    }
    await ctx.db.patch(current._id, {
      lastSuccessfulPollAt: args.now,
      lastOrderWatermark: args.watermark ?? current.lastOrderWatermark,
      lastFailureCode: undefined,
      lastFailureAt: undefined,
      updatedAt: args.now,
    });
    return { updated: true, reason: 'success_recorded' as const };
  },
});

export const getSecondaryOrderWatermark = internalQueryGeneric({
  args: { scopeKey: v.string() },
  handler: async (ctx, args) => ctx.db.query('secondaryOrderWatermarks').withIndex('by_scope_key', (q) => q.eq('scopeKey', args.scopeKey)).unique(),
});

/**
 * Durable delivery reservation. A `processing` record is intentionally not
 * auto-reclaimed: if an action stops after Slack receives the request, the
 * delivery outcome is ambiguous and must be reviewed rather than duplicated.
 */
export const beginSecondaryOrderNotification = internalMutationGeneric({
  args: { scopeKey: v.string(), salesforceOrderId: v.string(), orderWatermark: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const current = await ctx.db.query('secondaryOrderNotifications').withIndex('by_scope_order', (q: any) => q.eq('scopeKey', args.scopeKey).eq('salesforceOrderId', args.salesforceOrderId)).unique();
    if (current) return { acquired: false, status: current.status };
    await ctx.db.insert('secondaryOrderNotifications', {
      scopeKey: args.scopeKey,
      salesforceOrderId: args.salesforceOrderId,
      orderWatermark: args.orderWatermark,
      status: 'processing',
      attemptStartedAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { acquired: true, status: 'processing' as const };
  },
});

export const recordSecondaryOrderNotification = internalMutationGeneric({
  args: {
    scopeKey: v.string(), salesforceOrderId: v.string(), orderWatermark: v.string(), status: v.union(v.literal('sent'), v.literal('failed')),
    now: v.number(), failureCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const current = await ctx.db.query('secondaryOrderNotifications').withIndex('by_scope_order', (q: any) => q.eq('scopeKey', args.scopeKey).eq('salesforceOrderId', args.salesforceOrderId)).unique();
    if (current && current.status !== 'processing') return { recorded: false, status: current.status, id: current._id };
    const value = {
      orderWatermark: args.orderWatermark,
      status: args.status,
      sentAt: args.status === 'sent' ? args.now : undefined,
      failureCode: args.failureCode,
      updatedAt: args.now,
    };
    if (current) {
      await ctx.db.patch(current._id, value);
      return { recorded: true, status: args.status, id: current._id };
    }
    const id = await ctx.db.insert('secondaryOrderNotifications', {
      scopeKey: args.scopeKey,
      salesforceOrderId: args.salesforceOrderId,
      attemptStartedAt: args.now,
      createdAt: args.now,
      ...value,
    });
    return { recorded: true, status: args.status, id };
  },
});

/**
 * Explicit operator resolution for an ambiguous delivery. `sent` means Slack
 * delivery was independently confirmed; `skipped` means the notification was
 * deliberately waived. Neither outcome performs an external side effect.
 */
export const resolveSecondaryOrderNotification = internalMutationGeneric({
  args: {
    scopeKey: v.string(),
    salesforceOrderId: v.string(),
    resolution: v.union(v.literal('sent'), v.literal('skipped')),
    resolutionNote: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const current = await ctx.db.query('secondaryOrderNotifications').withIndex('by_scope_order', (q: any) => q.eq('scopeKey', args.scopeKey).eq('salesforceOrderId', args.salesforceOrderId)).unique();
    if (!current || (current.status !== 'processing' && current.status !== 'failed')) {
      return { resolved: false, status: current?.status ?? 'not_found' };
    }
    const resolutionNote = args.resolutionNote.trim().slice(0, 500);
    if (!resolutionNote) return { resolved: false, status: current.status };
    await ctx.db.patch(current._id, {
      status: args.resolution,
      sentAt: args.resolution === 'sent' ? (current.sentAt ?? args.now) : undefined,
      resolvedAt: args.now,
      resolutionNote,
      updatedAt: args.now,
    });
    return { resolved: true, status: args.resolution };
  },
});

export const getSecondaryOrderNotification = internalQueryGeneric({
  args: { scopeKey: v.string(), salesforceOrderId: v.string() },
  handler: async (ctx, args) => ctx.db.query('secondaryOrderNotifications').withIndex('by_scope_order', (q: any) => q.eq('scopeKey', args.scopeKey).eq('salesforceOrderId', args.salesforceOrderId)).unique(),
});

export const recordIntegrationStatus = internalMutationGeneric({
  args: {
    component: integrationComponent,
    outcome: integrationOutcome,
    now: v.number(),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => writeIntegrationStatus(ctx.db, args),
});

export const getIntegrationStatus = internalQueryGeneric({
  args: { component: integrationComponent },
  handler: async (ctx, args) => ctx.db.query('integrationStatus').withIndex('by_component', (q) => q.eq('component', args.component)).unique(),
});

export const cleanupExpired = internalMutationGeneric({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit, 1), 500);
    const tableNames = ['slackIngress', 'idempotencyKeys', 'interactionStates', 'orderBuilders', 'pendingArsChanges', 'appHomePublishes', 'partialOrderReminders', 'grnFollowups'] as const;
    let deleted = 0;
    for (const tableName of tableNames) {
      if (deleted >= limit) break;
      const expired = await ctx.db.query(tableName).withIndex('by_expires_at', (q) => q.lte('expiresAt', args.now)).take(limit - deleted);
      for (const item of expired) { await ctx.db.delete(item._id); deleted += 1; }
    }
    return deleted;
  },
});

export const getIdempotencyStatus = internalQueryGeneric({
  args: { key: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const entry = await ctx.db.query('idempotencyKeys').withIndex('by_key', (q) => q.eq('key', args.key)).unique();
    return entry && entry.expiresAt > args.now ? entry.status : null;
  },
});

export const idempotencyStatusValidator = idempotencyStatus;
