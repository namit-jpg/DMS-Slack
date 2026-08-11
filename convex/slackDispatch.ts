import { anyApi, internalActionGeneric } from 'convex/server';
import { v } from 'convex/values';
import { env } from './_generated/server';
import { resolveSlackDistributorContext } from './identity';
import { createSalesforceDomain } from './salesforceDomain';
import { callSlackWebApi, postResponseUrl } from './slackApi';
import {
  dispatchTransportNeutralSlack,
  type OrderBuilderState,
  type PendingArsChange,
  type SlackHandlerDependencies,
  type SlackHandlerMessage,
  type SlackIngressReceipt,
  type SlackSalesforceDomain,
} from './slackHandlers';

type ActionContext = {
  runMutation: (reference: any, args: any) => Promise<any>;
  runQuery: (reference: any, args: any) => Promise<any>;
  runAction: (reference: any, args: any) => Promise<any>;
};

function blocksForFallback(message: SlackHandlerMessage): Record<string, unknown>[] {
  if (message.blocks?.length) return message.blocks;
  return [{ type: 'section', text: { type: 'mrkdwn', text: message.text } }];
}

/** Slack response URLs do not replace a published App Home view reliably. */
export function shouldPublishHomeResponse(receipt: Pick<SlackIngressReceipt, 'payload'>): boolean {
  return receipt.payload.containerType === 'view';
}

async function publishHome(userId: string, blocks: Record<string, unknown>[]): Promise<void> {
  await callSlackWebApi(env.SLACK_BOT_TOKEN, 'views.publish', {
    user_id: userId,
    view: { type: 'home', blocks },
  });
}

function createStatePort(ctx: ActionContext): SlackHandlerDependencies['state'] {
  return {
    async getOrderBuilder(teamId, userId, now) {
      return await ctx.runQuery(anyApi.operationalState.getActiveOrderBuilder, { teamId, userId, now }) as OrderBuilderState | null;
    },
    async putOrderBuilder(teamId, userId, state, now, expiresAt) {
      await ctx.runMutation(anyApi.operationalState.putOrderBuilder, {
        teamId, userId, selected: state.selected, selectedCreditNoteIds: state.selectedCreditNoteIds, quote: state.quote, now, expiresAt,
      });
    },
    async clearOrderBuilder(teamId, userId) {
      await ctx.runMutation(anyApi.operationalState.clearOrderBuilder, { teamId, userId });
    },
    async acquireIdempotency(key, now, expiresAt) {
      return await ctx.runMutation(anyApi.operationalState.acquireIdempotency, { key, now, expiresAt });
    },
    async completeIdempotency(key, now, resultReference) {
      await ctx.runMutation(anyApi.operationalState.completeIdempotency, { key, now, resultReference });
    },
    async failIdempotency(key, now, code) {
      await ctx.runMutation(anyApi.operationalState.failIdempotency, { key, now, errorCode: code });
    },
    async acquireAppHomePublish(teamId, userId, now) {
      return await ctx.runMutation(anyApi.operationalState.acquireAppHomePublish, {
        teamId, userId, now, suppressionMs: 5_000, expiresAt: now + 24 * 60 * 60 * 1000,
      });
    },
    async savePendingArsChange(change, now, expiresAt) {
      await ctx.runMutation(anyApi.operationalState.savePendingArsChange, { ...change, now, expiresAt });
    },
    async getPendingArsChange(teamId, channelId, messageTs, now) {
      return await ctx.runQuery(anyApi.operationalState.getPendingArsChange, { teamId, channelId, messageTs, now }) as PendingArsChange | null;
    },
    async resolvePendingArsChange(teamId, channelId, messageTs, status, now) {
      await ctx.runMutation(anyApi.operationalState.resolvePendingArsChange, { teamId, channelId, messageTs, status, now });
    },
    async upsertPartialReminder(input) {
      // This action both upserts durable reminder state and schedules its
      // exact delivery. Calling the state mutation directly would recreate
      // the old VM's record but silently omit the notification job.
      await ctx.runAction(anyApi.reminders.register, {
        salesforceOrderId: input.salesforceOrderId,
        salesforceAccountId: input.salesforceAccountId,
        teamId: input.teamId,
        slackUserId: input.slackUserId,
        orderNumber: input.orderNumber,
        retailerCustomer: input.retailerCustomer,
        pendingItemCount: input.pendingItemCount,
        now: input.now,
        expiresAt: input.expiresAt,
      });
    },
    async scheduleGRNFollowup(input) {
      await ctx.runMutation(anyApi.operationalState.scheduleGRNFollowup, input);
    },
    async deactivatePartialReminder(orderId, now) {
      await ctx.runMutation(anyApi.operationalState.deactivatePartialOrderReminder, { salesforceOrderId: orderId, now });
    },
  };
}

function createDependencies(ctx: ActionContext): SlackHandlerDependencies {
  return {
    now: () => Date.now(),
    resolveDistributor: (teamId, userId, sourceTeamId) => resolveSlackDistributorContext(teamId, userId, sourceTeamId),
    domainFor: (context) => createSalesforceDomain(context, {
      allowBusinessWrites: String(env.ALLOW_LIVE_BUSINESS_WRITES_FROM_SLACK) === 'true',
    }) satisfies SlackSalesforceDomain,
    state: createStatePort(ctx),
    async respond(receipt, message) {
      const now = Date.now();
      // App Home is a `view` container. Its interaction response URL may
      // acknowledge successfully without replacing the published Home view,
      // leaving a completed action looking like an unchanged product search.
      // Publish the new Home view explicitly; keep response URLs for message
      // and modal interactions where replacement is supported.
      if (shouldPublishHomeResponse(receipt)) {
        await publishHome(receipt.userId, blocksForFallback(message));
        return;
      }
      if (receipt.responseUrl && (receipt.responseUrlExpiresAt ?? 0) > now) {
        try {
          await postResponseUrl(receipt.responseUrl, message as unknown as Record<string, unknown>);
          return;
        } catch {
          // Slack response URLs can expire or be disabled for a workspace.
        }
      }
      await publishHome(receipt.userId, blocksForFallback(message));
    },
    publishHome,
    async postMessage(input) {
      const result = await callSlackWebApi(env.SLACK_BOT_TOKEN, 'chat.postMessage', {
        channel: input.channel,
        text: input.text,
        blocks: input.blocks,
        thread_ts: input.threadTs,
      });
      const channel = typeof result.channel === 'string' ? result.channel : input.channel;
      const ts = typeof result.ts === 'string' ? result.ts : '';
      if (!ts) throw new Error('Slack chat.postMessage returned no message timestamp');
      return { channel, ts };
    },
    salesChannelId: env.SLACK_SALES_CHANNEL_ID,
    allowBusinessWrites: String(env.ALLOW_LIVE_BUSINESS_WRITES_FROM_SLACK) === 'true',
  };
}

export const processReceipt = internalActionGeneric({
  args: { dedupeKey: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const receipt = await ctx.runMutation(anyApi.operationalState.markSlackIngressProcessing, { dedupeKey: args.dedupeKey, now });
    if (!receipt) return { processed: false, reason: 'not_accepted' };

    try {
      const result = await dispatchTransportNeutralSlack(createDependencies(ctx), receipt as SlackIngressReceipt);
      await ctx.runMutation(anyApi.operationalState.markSlackIngressTerminal, {
        dedupeKey: args.dedupeKey,
        status: 'completed',
        now: Date.now(),
      });
      return { processed: true, handlerId: result.handlerId, routeFamily: result.routeFamily };
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'DISPATCH_FAILED';
      await ctx.runMutation(anyApi.operationalState.markSlackIngressTerminal, {
        dedupeKey: args.dedupeKey,
        status: 'failed',
        now: Date.now(),
        errorCode: code.slice(0, 80),
      });
      return { processed: false, reason: 'dispatch_failed', errorCode: code.slice(0, 80) };
    }
  },
});
