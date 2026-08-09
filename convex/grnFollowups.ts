import { anyApi, internalActionGeneric } from 'convex/server';
import { v } from 'convex/values';
import { env } from './_generated/server';
import { createSalesforceDomain } from './salesforceDomain';
import { callSlackWebApi, postResponseUrl } from './slackApi';
import { buildGRNEntryForm } from '../src/slack/blocks/extendedBlocks';
import { buildButton, buildHeader, buildSection } from '../src/slack/blocks/commonBlocks';

type Followup = {
  followupKey: string;
  teamId: string;
  userId: string;
  orderId: string;
  dispatchName: string;
  invoiceId?: string;
  context: any;
  responseUrl?: string;
  responseUrlExpiresAt?: number;
  attempt: number;
};

type Message = { text: string; blocks?: Record<string, unknown>[]; replace_original?: boolean };
const MAX_GRN_CHECKS = 4;

function blocksForFallback(message: Message): Record<string, unknown>[] {
  return message.blocks?.length ? message.blocks : [{ type: 'section', text: { type: 'mrkdwn', text: message.text } }];
}

async function respond(followup: Followup, message: Message): Promise<void> {
  if (followup.responseUrl && (followup.responseUrlExpiresAt ?? 0) > Date.now()) {
    try {
      await postResponseUrl(followup.responseUrl, message as Record<string, unknown>);
      return;
    } catch {
      // Response URLs are short-lived. App Home is the safe durable fallback.
    }
  }
  await callSlackWebApi(env.SLACK_BOT_TOKEN, 'views.publish', {
    user_id: followup.userId,
    view: { type: 'home', blocks: blocksForFallback(message) },
  });
}

async function complete(ctx: any, followup: Followup, status: 'completed' | 'failed', errorCode?: string): Promise<void> {
  await ctx.runMutation(anyApi.operationalState.completeGRNFollowup, {
    followupKey: followup.followupKey, status, errorCode, now: Date.now(),
  });
}

export const check = internalActionGeneric({
  args: { followupKey: v.string(), dueAt: v.number() },
  handler: async (ctx, args) => {
    const followup = await ctx.runMutation(anyApi.operationalState.claimGRNFollowup, {
      followupKey: args.followupKey, dueAt: args.dueAt, now: Date.now(),
    }) as Followup | null;
    if (!followup) return { checked: false, reason: 'superseded_or_expired' };

    const domain = createSalesforceDomain(followup.context, {
      allowBusinessWrites: String(env.ALLOW_LIVE_BUSINESS_WRITES_FROM_SLACK) === 'true',
    });
    try {
      const receiptLines = await domain.getGoodsReceiptLines(followup.orderId);
      if (receiptLines.length > 0) {
        await respond(followup, {
          text: ':package: Record GRN quantities',
          blocks: buildGRNEntryForm(followup.orderId, '', followup.dispatchName, receiptLines.map((line) => ({ productId: line.lineId, productName: line.productName, quantity: line.orderedQuantity }))) as Record<string, unknown>[],
          replace_original: false,
        });
        await complete(ctx, followup, 'completed');
        return { checked: true, outcome: 'grn_lines_ready' };
      }

      if (followup.invoiceId) {
        const invoiceLines = await domain.getInvoiceLineItems(followup.invoiceId).catch(() => []);
        if (invoiceLines.length > 0) {
          await respond(followup, {
            text: ':package: Record GRN quantities',
            blocks: buildGRNEntryForm(followup.orderId, followup.invoiceId, followup.dispatchName, invoiceLines) as Record<string, unknown>[],
            replace_original: false,
          });
          await complete(ctx, followup, 'completed');
          return { checked: true, outcome: 'invoice_lines_ready' };
        }
      }

      if (followup.attempt + 1 < MAX_GRN_CHECKS) {
        await ctx.runMutation(anyApi.operationalState.rescheduleGRNFollowup, { followupKey: followup.followupKey, now: Date.now() });
        return { checked: true, outcome: 'rescheduled' };
      }

      if ((await domain.getDispatchRequests(followup.orderId)).every((dispatch) => dispatch.status === 'Delivered')) {
        await ctx.runMutation(anyApi.operationalState.deactivatePartialOrderReminder, { salesforceOrderId: followup.orderId, now: Date.now() });
      }
      await respond(followup, {
        text: ':white_check_mark: Delivery Confirmed',
        blocks: [
          buildHeader(':white_check_mark: Delivery Confirmed'),
          buildSection(`Dispatch *${followup.dispatchName}* marked as *Delivered*. The GRN lines are still being prepared in Salesforce; use View Order and try again shortly.`),
          { type: 'actions', elements: [buildButton(':twisted_rightwards_arrows: View Order', `view_so_detail_${followup.orderId}`, followup.orderId)] },
        ] as Record<string, unknown>[],
        replace_original: false,
      });
      await complete(ctx, followup, 'completed');
      return { checked: true, outcome: 'delivery_confirmed_without_grn' };
    } catch (error) {
      const errorCode = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code.slice(0, 80) : 'GRN_FOLLOWUP_FAILED';
      if (followup.attempt + 1 < MAX_GRN_CHECKS) {
        await ctx.runMutation(anyApi.operationalState.rescheduleGRNFollowup, { followupKey: followup.followupKey, now: Date.now(), errorCode });
        return { checked: true, outcome: 'rescheduled_after_error' };
      }
      await complete(ctx, followup, 'failed', errorCode);
      return { checked: true, outcome: 'failed', errorCode };
    }
  },
});
