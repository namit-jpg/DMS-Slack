import { anyApi, internalActionGeneric } from 'convex/server';
import { v } from 'convex/values';
import { callSlackWebApi } from './slackApi';
import { env } from './_generated/server';

const REMINDER_INTERVAL_MS = 30 * 60 * 1000;

export const register = internalActionGeneric({
  args: {
    salesforceOrderId: v.string(), salesforceAccountId: v.string(), teamId: v.string(), slackUserId: v.string(), orderNumber: v.string(), retailerCustomer: v.string(),
    pendingItemCount: v.number(), now: v.number(), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const dueAt = args.now + REMINDER_INTERVAL_MS;
    await ctx.runMutation(anyApi.operationalState.upsertPartialOrderReminder, { ...args, nextReminderAt: dueAt });
    return dueAt;
  },
});

export const deliver = internalActionGeneric({
  args: { salesforceOrderId: v.string(), dueAt: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const nextReminderAt = now + REMINDER_INTERVAL_MS;
    const reminder = await ctx.runMutation(anyApi.operationalState.claimPartialOrderReminder, { ...args, nextReminderAt, now });
    if (!reminder) return { delivered: false, reason: 'inactive_or_superseded' };

    let delivered = false;
    try {
      await callSlackWebApi(env.SLACK_BOT_TOKEN, 'chat.postMessage', {
        channel: reminder.slackUserId,
        text: `:warning: *Partial Order Reminder* — Secondary order *${reminder.orderNumber}* for *${reminder.retailerCustomer}* has *${reminder.pendingItemCount}* product(s) with pending quantities. Please process the remaining invoice once stock is available.`,
      });
      await ctx.runMutation(anyApi.operationalState.recordPartialOrderReminderResult, { salesforceOrderId: args.salesforceOrderId, sentAt: Date.now(), now: Date.now() });
      delivered = true;
    } catch {
      await ctx.runMutation(anyApi.operationalState.recordPartialOrderReminderResult, { salesforceOrderId: args.salesforceOrderId, now: Date.now(), errorCode: 'SLACK_DELIVERY_FAILED' });
    }
    return delivered ? { delivered: true } : { delivered: false, reason: 'slack_delivery_failed' };
  },
});
