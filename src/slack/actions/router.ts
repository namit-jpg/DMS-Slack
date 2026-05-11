import { App } from '@slack/bolt';
import { SLACK_ACTION_IDS } from '../../config/slackConstants';
import { IdentityPipeline } from '../../identity/IdentityPipeline';
import { ISalesforceClient, ResolvedDistributorContext, PrimaryOrderQuote, GRNPayload, InvoicePayload, ArsConfig, ArsTriggeredOrder, BatchStockPolicy } from '../../salesforce/types';
import { getClientMode } from '../../salesforce/SalesforceClient';
import { BLOCKERS } from '../../salesforce/blockers';
import { InsightsService } from '../../services/InsightsService';
import { ReportsService } from '../../services/ReportsService';
import { buildReportDashboardBlocks } from '../blocks/reportBlocks';
import { buildMainMenuBlocks, buildUserErrorBlocks, buildSection, buildHeader, buildDivider, buildButton, buildContext } from '../blocks/commonBlocks';
import { buildDashboardView } from '../blocks/dashboardBlocks';
import { buildInsightBlocks } from '../blocks/insightBlocks';
import { buildInventoryBlocks } from '../blocks/inventoryBlocks';
import {
  buildProductSelectionModal, buildOrderQuoteReview, buildOrderConfirmation,
  buildOrderListBlocks, buildOrderDetailBlocks,
  buildGRNModal, buildGRNConfirmation,
  buildReturnOrderListBlocks, buildReturnOrderDetailBlocks,
  buildClaimModal, buildClaimConfirmation, buildApprovalResult,
} from '../blocks/orderBlocks';
import {
  buildSecondaryOrderList, buildSecondaryOrderDetail, buildInvoiceProcessing, buildInvoiceConfirmation,
  buildARSDashboard, buildAIInsightsDashboard, buildAIRecommendationApplied, buildAIFallback,
  buildARSApprovalMessage, buildARSApprovalAcknowledgement, buildARSEditProduct, buildARSChangeRequestForm,
} from '../blocks/extendedBlocks';
import { createChildLogger } from '../../utils/logger';
import { checkIdempotency, markProcessing, markCompleted, markFailed } from '../../persistence/idempotencyStore';

const logger = createChildLogger('ActionRouter');

interface OrderBuilderState {
  selected: Array<{ productId: string; quantity: number; schemeDiscount?: number }>;
  selectedCreditNoteIds?: string[];
  quote?: PrimaryOrderQuote;
}

const orderBuilders = new Map<string, OrderBuilderState>();

const pendingARSChanges = new Map<string, {
  userId: string;
  userName: string;
  accountName: string;
  accountId: string;
  changes: Array<{ productId: string; productName: string; oldMin: number; newMin: number; oldMax: number; newMax: number }>;
  channelId: string;
  messageTs: string;
}>();

export function registerAllActions(
  app: App,
  pipeline: IdentityPipeline,
  sfClient: ISalesforceClient,
  insightsService: InsightsService,
) {
  const reportsService = new ReportsService(sfClient);

  const safeRespond = async (
    body: any,
    respond: unknown,
    message: { text?: string; blocks?: any[]; replace_original?: boolean; [key: string]: unknown },
  ) => {
    if (typeof respond === 'function') {
      try {
        await (respond as (message: unknown) => Promise<void>)(message);
        return;
      } catch (err: any) {
        if (err?.data?.error !== 'messages_tab_disabled') {
          logger.warn({ err }, 'respond() failed, falling back to home tab');
        }
      }
    }

    const userId = body?.user?.id;
    if (!userId) return;

    const blocks = message.blocks && message.blocks.length > 0
      ? message.blocks
      : buildUserErrorBlocks(message.text || 'Action completed.');

    await app.client.views.publish({
      user_id: userId,
      view: { type: 'home', blocks },
    });
  };

  app.action('search_products_button', async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);

      let searchTerm = '';
      const stateValues = (body as any).view?.state?.values || (body as any).state?.values || {};
      const inputVal = stateValues.product_search_block?.search_products_input?.value;
      if (inputVal && typeof inputVal === 'string') {
        searchTerm = inputVal.trim().toLowerCase();
      }

      logger.info({ userId, searchTerm, hasState: !!Object.keys(stateValues).length }, 'Search triggered');
      const allProducts = await sfClient.getAvailableProducts(ctx);
      const filtered = searchTerm
        ? allProducts.filter((p) =>
            (p.productName || '').toLowerCase().includes(searchTerm) ||
            (p.productCode || '').toLowerCase().includes(searchTerm) ||
            (p.family || '').toLowerCase().includes(searchTerm) ||
            (p.category || '').toLowerCase().includes(searchTerm))
        : allProducts;

      const state = orderBuilders.get(userId) || { selected: [] };
      state.selected = hydrateSelectedFromSlackState(state.selected, body);
      orderBuilders.set(userId, state);

      const blocks = buildProductSelectionModal(filtered, state.selected);
      const label = searchTerm ? `Search: "${searchTerm}" (${filtered.length} results)` : `All products (${filtered.length})`;
      await safeRespond(body, respond, { text: label, blocks, replace_original: true });

    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      logger.error({ err }, 'Search failed');
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action(SLACK_ACTION_IDS.SELECT_ORDER_TYPE, async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const products = await sfClient.getAvailableProducts(ctx);
      orderBuilders.set(userId, { selected: [] });
      const blocks = buildProductSelectionModal(products, []);
      await safeRespond(body, respond, { text: 'Create Primary Order', blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, blocks: buildUserErrorBlocks(userMessage), replace_original: false });
    }
  });

  app.action(/^add_product_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const productId = (action as any).action_id.replace('add_product_', '');
      const state = orderBuilders.get(userId) || { selected: [] };
      state.selected = hydrateSelectedFromSlackState(state.selected, body);
      const existing = state.selected.find((s) => s.productId === productId);
      if (!existing) {
        const products = await sfClient.getAvailableProducts(ctx);
        const product = products.find((p) => p.productId === productId);
        state.selected.push({ productId, quantity: Math.max(1, product?.minOrderQtyPrimary || 1), schemeDiscount: 0 });
      }
      orderBuilders.set(userId, state);
      const products = await sfClient.getAvailableProducts(ctx);
      const blocks = buildProductSelectionModal(products, state.selected);
      await safeRespond(body, respond, { text: 'Create Primary Order', blocks, replace_original: true });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action('review_order_quote', async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const state = orderBuilders.get(userId);
      if (!state || state.selected.length === 0) {
        await safeRespond(body, respond, { text: 'No products selected. Please add products first.', replace_original: false });
        return;
      }
      const selected = hydrateSelectedFromSlackState(state.selected, body);
      const products = await sfClient.getAvailableProducts(ctx);
      const minFailures = selected
        .map((item) => ({ item, product: products.find((p) => p.productId === item.productId) }))
        .filter(({ item, product }) => product && item.quantity < Math.max(1, product.minOrderQtyPrimary || 1));
      if (minFailures.length > 0) {
        const message = minFailures
          .map(({ item, product }) => `${product?.productName || item.productId}: minimum quantity is ${Math.max(1, product?.minOrderQtyPrimary || 1)}`)
          .join('\n');
        await safeRespond(body, respond, {
          text: 'Minimum quantity validation failed.',
          blocks: [
            buildHeader(':warning: Minimum Quantity Required'),
            buildSection(`Please update quantities before review:\n${message}`),
            buildDivider(),
            ...buildProductSelectionModal(products, selected),
          ],
          replace_original: true,
        });
        return;
      }
      state.selected = selected;
      state.selectedCreditNoteIds = [];
      const quote = await sfClient.calculatePrimaryOrderQuote(ctx, selected, []);
      state.quote = quote;
      orderBuilders.set(userId, state);
      const blocks = buildOrderQuoteReview(quote);
      await safeRespond(body, respond, { text: 'Order Quote', blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action(SLACK_ACTION_IDS.SUBMIT_PRIMARY_ORDER, async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const state = orderBuilders.get(userId);
      if (!state?.quote) {
        await safeRespond(body, respond, { text: 'No quote available. Please rebuild your order.', replace_original: false });
        return;
      }
      const stateValues = (body as any).view?.state?.values || (body as any).state?.values || {};
      const selectedCreditNoteIds = (stateValues.credit_notes?.select_credit_notes?.selected_options || [])
        .map((option: any) => option.value)
        .filter((value: unknown): value is string => typeof value === 'string');
      if (selectedCreditNoteIds.length > 0) {
        state.quote = await sfClient.calculatePrimaryOrderQuote(ctx, state.selected, selectedCreditNoteIds);
        state.selectedCreditNoteIds = selectedCreditNoteIds;
        orderBuilders.set(userId, state);
      }
      const idempotencyKey = `po-create-${userId}-${state.quote.quoteId}`;
      const existing = checkIdempotency(idempotencyKey);
      if (existing === 'processing') {
        await safeRespond(body, respond, { text: 'Order creation is already in progress.' });
        return;
      }
      markProcessing(idempotencyKey);
      const order = await sfClient.createPrimaryOrder(ctx, state.quote);
      orderBuilders.delete(userId);
      markCompleted(idempotencyKey, order);
      const blocks = buildOrderConfirmation(order);
      await safeRespond(body, respond, { text: 'Order Created', blocks, replace_original: false });
    } catch (err) {
      const state = orderBuilders.get(body.user.id);
      if (state?.quote) {
        const idempotencyKey = `po-create-${body.user.id}-${state.quote.quoteId}`;
        markFailed(idempotencyKey);
      }
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action(SLACK_ACTION_IDS.VIEW_ORDER_DETAIL, async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const orders = await sfClient.getPrimaryOrders(ctx);
      const blocks = buildOrderListBlocks(orders);
      await safeRespond(body, respond, { text: 'Your Orders', blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, blocks: buildUserErrorBlocks(userMessage), replace_original: false });
    }
  });

  app.action('search_orders_button', async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const stateValues = (body as any).view?.state?.values || (body as any).state?.values || {};
      const searchTerm = (stateValues.order_search_block?.search_orders_input?.value || '').trim();
      const orders = await sfClient.getPrimaryOrders(ctx);
      const blocks = buildOrderListBlocks(orders, searchTerm);
      await safeRespond(body, respond, { text: `Orders matching "${searchTerm}"`, blocks, replace_original: true });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action(/^view_po_detail_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const orderId = (action as any).action_id.replace('view_po_detail_', '');
      const detail = await sfClient.getPrimaryOrderDetails(ctx, orderId);
      const blocks = buildOrderDetailBlocks(detail);
      await safeRespond(body, respond, { text: `Order ${detail.orderNumber}`, blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, blocks: buildUserErrorBlocks(userMessage), replace_original: false });
    }
  });

  app.action(/^process_grn_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const orderId = (action as any).action_id.replace('process_grn_', '');
      const detail = await sfClient.getPrimaryOrderDetails(ctx, orderId);
      const blocks = buildGRNModal(detail);
      await safeRespond(body, respond, { text: 'Process GRN', blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action('submit_grn_form', async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const orderId = (action as any).value;
      const detail = await sfClient.getPrimaryOrderDetails(ctx, orderId);
      const payload: GRNPayload = { items: [], notes: '' };
      const grnState = (body as any).view?.state?.values || (body as any).state?.values || {};
      for (const li of detail.items) {
        const recv = parseInt(grnState[`grn_recv_${li.productId}`]?.[`grn_input_recv_${li.productId}`]?.value || '0') || 0;
        const dmg = parseInt(grnState[`grn_dmg_${li.productId}`]?.[`grn_input_dmg_${li.productId}`]?.value || '0') || 0;
        const miss = parseInt(grnState[`grn_miss_${li.productId}`]?.[`grn_input_miss_${li.productId}`]?.value || '0') || 0;
        payload.items.push({ productId: li.productId, expectedQuantity: li.expectedQuantity, receivedQuantity: recv, damagedQuantity: dmg, missingQuantity: miss });
      }
      payload.notes = grnState.grn_notes?.grn_input_notes?.value || '';

      const idempotencyKey = `grn-create-${userId}-${orderId}-${Date.now()}`;
      checkIdempotency(idempotencyKey);
      markProcessing(idempotencyKey);
      const grn = await sfClient.createOrUpdateGRN(ctx, orderId, payload);
      markCompleted(idempotencyKey, grn);
      const blocks = buildGRNConfirmation(grn);
      await safeRespond(body, respond, { text: 'GRN Confirmation', blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action('returns_claims_menu', async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const returns = await sfClient.getReturnOrders(ctx);
      const blocks = buildReturnOrderListBlocks(returns);
      await safeRespond(body, respond, { text: 'Returns & Claims', blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, blocks: buildUserErrorBlocks(userMessage), replace_original: false });
    }
  });

  app.action(/^view_ro_detail_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const returnOrderId = (action as any).action_id.replace('view_ro_detail_', '');
      const detail = await sfClient.getReturnOrderDetails(ctx, returnOrderId);
      const claims = await sfClient.getClaims(ctx, returnOrderId);
      const approval = await sfClient.getApprovalStatus(ctx, returnOrderId, 'Return_Order__c');
      const creditNotes = await sfClient.getCreditNotes(ctx, returnOrderId);
      const blocks = buildReturnOrderDetailBlocks(detail, claims, approval, creditNotes);
      await safeRespond(body, respond, { text: `Return ${detail.returnNumber}`, blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action(/^file_claim_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const returnOrderId = (action as any).action_id.replace('file_claim_', '');
      const blocks = buildClaimModal(returnOrderId);
      await safeRespond(body, respond, { text: 'File a Claim', blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action(/^submit_claim_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const returnOrderId = (action as any).action_id.replace('submit_claim_', '');
      const values = (body as any).view?.state?.values || (body as any).state?.values || {};
      const claimType = values.claim_type?.claim_input_type?.selected_option?.value || 'Other';
      const amount = parseFloat(values.claim_amount?.claim_input_amount?.value || '0') || 0;
      const desc = values.claim_desc?.claim_input_desc?.value || '';

      const idempotencyKey = `claim-create-${userId}-${returnOrderId}-${Date.now()}`;
      checkIdempotency(idempotencyKey);
      markProcessing(idempotencyKey);
      const claim = await sfClient.createOrUpdateClaim(ctx, { returnOrderId, claimType, amount, description: desc });
      markCompleted(idempotencyKey, claim);
      const blocks = buildClaimConfirmation(claim);
      await safeRespond(body, respond, { text: 'Claim Submitted', blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action(/^submit_approval_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const recordId = (action as any).action_id.replace('submit_approval_', '');
      const result = await sfClient.submitForApproval(ctx, recordId, 'Return_Order__c');
      const blocks = buildApprovalResult(result);
      await safeRespond(body, respond, { text: 'Approval', blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action(SLACK_ACTION_IDS.BACK_TO_MENU, async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { identity, context: ctx } = await pipeline.resolve(userId);
      const metricsResult = await insightsService.getDashboardMetrics(ctx);
      const insightsResult = await insightsService.getBusinessInsights(ctx);
      const metrics = metricsResult.success ? metricsResult.data : buildEmptyDashboardMetrics();
      const insights = insightsResult.success ? insightsResult.data : [];
      const view = buildDashboardView(identity.displayName, metrics, insights);
      await safeRespond(body, respond, { text: 'DMS Dashboard', ...view, replace_original: true });
    } catch {
      const view = buildDashboardView('User', buildEmptyDashboardMetrics(), []);
      await safeRespond(body, respond, { text: 'DMS Dashboard', ...view, replace_original: true });
    }
  });

  app.action(SLACK_ACTION_IDS.CANCEL_ACTION, async ({ ack, body, respond }) => {
    await ack();
    const userId = body.user.id;
    orderBuilders.delete(userId);
    try {
      const { identity, context: ctx } = await pipeline.resolve(userId);
      const metricsResult = await insightsService.getDashboardMetrics(ctx);
      const insightsResult = await insightsService.getBusinessInsights(ctx);
      const metrics = metricsResult.success ? metricsResult.data : buildEmptyDashboardMetrics();
      const insights = insightsResult.success ? insightsResult.data : [];
      const view = buildDashboardView(identity.displayName, metrics, insights);
      await safeRespond(body, respond, { text: 'DMS Dashboard', ...view, replace_original: true });
    } catch {
      const view = buildDashboardView('User', buildEmptyDashboardMetrics(), []);
      await safeRespond(body, respond, { text: 'DMS Dashboard', ...view, replace_original: true });
    }
  });

  app.action('insights_menu', async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const data = await reportsService.fetchAllReportData(ctx);
      const blocks = buildReportDashboardBlocks(data);
      await safeRespond(body, respond, { text: 'Business Insights', blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action('refresh_insights', async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { identity, context: ctx } = await pipeline.resolve(userId);
      const metricsResult = await insightsService.getDashboardMetrics(ctx);
      const insightsResult = await insightsService.getBusinessInsights(ctx);
      const metrics = metricsResult.success ? metricsResult.data : buildEmptyDashboardMetrics();
      const insights = insightsResult.success ? insightsResult.data : [];
      const view = buildDashboardView(identity.displayName, metrics, insights);
      await safeRespond(body, respond, { text: 'Dashboard', ...view, replace_original: true });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });

  app.action('secondary_orders_menu', async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const orders = await sfClient.getSecondaryOrders(ctx);
      const blocks = buildSecondaryOrderList(orders);
      await safeRespond(body, respond, { text: 'Secondary Orders', blocks, replace_original: false });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action('search_so_button', async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { context: ctx } = await pipeline.resolve(userId);
      const stateValues = (body as any).view?.state?.values || (body as any).state?.values || {};
      const searchTerm = (stateValues.so_search_block?.search_so_input?.value || '').trim();
      const orders = await sfClient.getSecondaryOrders(ctx);
      const blocks = buildSecondaryOrderList(orders, searchTerm);
      await safeRespond(body, respond, { text: `Secondary orders matching "${searchTerm}"`, blocks, replace_original: true });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action(/^view_so_detail_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id; const { context: ctx } = await pipeline.resolve(userId);
      const orderId = (action as any).action_id.replace('view_so_detail_', '');
      const detail = await sfClient.getSecondaryOrderDetails(ctx, orderId);
      await safeRespond(body, respond, { text: `SO ${detail.orderNumber}`, blocks: buildSecondaryOrderDetail(detail), replace_original: false });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action(/^process_so_invoice_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id; const { context: ctx } = await pipeline.resolve(userId);
      const orderId = (action as any).action_id.replace('process_so_invoice_', '');
      const availability = await sfClient.getInventoryAvailability(ctx, orderId);
      await safeRespond(body, respond, { text: 'Process Invoice', blocks: buildInvoiceProcessing(orderId, availability), replace_original: false });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action(/^confirm_so_invoice_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id; const { context: ctx } = await pipeline.resolve(userId);
      const orderId = (action as any).action_id.replace('confirm_so_invoice_', '');
      const isPartial = (action as any).value === 'partial';
      const idempotencyKey = `so-inv-${userId}-${orderId}-${Date.now()}`;
      markProcessing(idempotencyKey);
      const invoice = await sfClient.createInvoice(ctx, orderId, { items: [], fullOrPartial: isPartial ? 'partial' : 'full', notes: '' });
      markCompleted(idempotencyKey, invoice);
      await safeRespond(body, respond, { text: 'Invoice Created', blocks: buildInvoiceConfirmation(invoice), replace_original: false });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action(/^so_dispatch_deliver_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id; const { context: ctx } = await pipeline.resolve(userId);
      const orderId = (action as any).action_id.replace('so_dispatch_deliver_', '');
      const dispatches = await sfClient.getDispatchRequests(ctx, orderId);
      if (dispatches.length === 0) { await safeRespond(body, respond, { text: 'No dispatch requests found for this order.' }); return; }
      const updated = await sfClient.updateDispatchStatus(ctx, dispatches[0].dispatchId, 'Delivered');
      await safeRespond(body, respond, { text: 'Dispatch Updated', blocks: [buildHeader(':white_check_mark: Delivery Confirmed'), buildSection(`Dispatch *${updated.dispatchName}* marked as *Delivered*.`)] });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action('ars_menu', async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id; const { context: ctx } = await pipeline.resolve(userId);
      let batches: BatchStockPolicy[] = [];
      try { batches = await sfClient.getBatchWiseStockPolicies(ctx); } catch { /* may fail */ }
      const resolvedConfig: ArsConfig = {
        autoReplenishmentEnabled: true, activeProducts: { productId: '', productName: '', currentStock: 0, minThreshold: 0, maxThreshold: 0, reorderPoint: 0, reorderQuantity: 0, isActive: false },
        minThreshold: 0, maxThreshold: 0, replenishmentFrequency: 'weekly', lastModifiedBy: 'N/A', lastModifiedDate: 'N/A',
      };
      const blocks = buildARSDashboard(resolvedConfig, [], batches);
      await safeRespond(body, respond, { text: 'ARS Dashboard', blocks, replace_original: false });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action('ars_search_button', async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id; const { context: ctx } = await pipeline.resolve(userId);
      const stateValues = (body as any).view?.state?.values || (body as any).state?.values || {};
      const searchTerm = (stateValues.ars_search_block?.ars_search_input?.value || '').trim().toLowerCase();
      let batches: BatchStockPolicy[] = [];
      try { batches = await sfClient.getBatchWiseStockPolicies(ctx); } catch { /* may fail */ }
      const resolvedConfig: ArsConfig = {
        autoReplenishmentEnabled: true, activeProducts: { productId: '', productName: '', currentStock: 0, minThreshold: 0, maxThreshold: 0, reorderPoint: 0, reorderQuantity: 0, isActive: false },
        minThreshold: 0, maxThreshold: 0, replenishmentFrequency: 'weekly', lastModifiedBy: 'N/A', lastModifiedDate: 'N/A',
      };
      const blocks = buildARSDashboard(resolvedConfig, [], batches, searchTerm);
      await safeRespond(body, respond, { text: `ARS: "${searchTerm}"`, blocks, replace_original: true });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action(/^ars_edit_product_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const productId = (action as any).action_id.replace('ars_edit_product_', '');
      const value = (action as any).value || '{}';
      const info = typeof value === 'string' ? JSON.parse(value) : value;
      const blocks = buildARSEditProduct(info);
      await safeRespond(body, respond, { text: `Edit ARS — ${info.productName}`, blocks, replace_original: false });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action(/^ars_submit_product_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { identity, context: ctx } = await pipeline.resolve(userId);
      const productId = (action as any).action_id.replace('ars_submit_product_', '');
      const stateValues = (body as any).view?.state?.values || (body as any).state?.values || {};
      const newMinVal = stateValues.ars_edit_min?.ars_edit_min_val?.value;
      const newMaxVal = stateValues.ars_edit_max?.ars_edit_max_val?.value;
      const value = (action as any).value || '{}';
      const info = typeof value === 'string' ? JSON.parse(value) : value;
      const newMin = parseInt(newMinVal || String(info.minStock), 10) || info.minStock;
      const newMax = parseInt(newMaxVal || String(info.maxStock), 10) || info.maxStock;

      const changes = [{
        productId, productName: info.productName,
        oldMin: info.minStock, newMin, oldMax: info.maxStock, newMax,
      }];

      const approvalBlocks = buildARSApprovalMessage(identity.displayName, ctx.accountName, changes);
      const salesChannel = process.env.SLACK_SALES_CHANNEL || 'sales';
      try {
        try { await app.client.conversations.join({ channel: salesChannel }); } catch { /* join may not be available if already member or lacking scope */ }
        const result = await app.client.chat.postMessage({
          channel: salesChannel,
          text: `ARS Change from ${identity.displayName}: ${info.productName}`,
          blocks: approvalBlocks,
        });
        if (result.ok && result.ts) {
          pendingARSChanges.set(result.ts, {
            userId, userName: identity.displayName, accountName: ctx.accountName, accountId: ctx.salesforceAccountId,
            changes, channelId: result.channel || salesChannel, messageTs: result.ts,
          });
        }
        await safeRespond(body, respond, { text: `:white_check_mark: ARS change for ${info.productName} sent to #${salesChannel} for approval.`, replace_original: false });
      } catch (channelErr: any) {
        logger.warn({ err: channelErr, salesChannel }, 'Could not post ARS approval to channel, falling back to DM');
        try {
          const dmResult = await app.client.chat.postMessage({
            channel: userId,
            text: `ARS Change Request — ${info.productName}`,
            blocks: approvalBlocks,
          });
          if (dmResult.ok && dmResult.ts) {
            pendingARSChanges.set(dmResult.ts, {
              userId, userName: identity.displayName, accountName: ctx.accountName, accountId: ctx.salesforceAccountId,
              changes, channelId: dmResult.channel || userId, messageTs: dmResult.ts,
            });
          }
          await safeRespond(body, respond, { text: `:white_check_mark: ARS change request submitted. Sent to your DMs for approval (bot needs to be invited to #${salesChannel} for channel notifications).`, replace_original: false });
        } catch {
          await safeRespond(body, respond, { text: `:warning: Could not submit ARS change request. Please invite the bot to #${salesChannel} and try again.`, replace_original: false });
        }
      }
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action('ars_toggle_status', async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id; const { context: ctx } = await pipeline.resolve(userId);
      const activate = (action as any).value === 'activate';
      await sfClient.updateARSStatus(ctx, activate);
      let batches: BatchStockPolicy[] = [];
      try { batches = await sfClient.getBatchWiseStockPolicies(ctx); } catch { /* may fail */ }
      const config: ArsConfig = {
        autoReplenishmentEnabled: activate, activeProducts: { productId: '', productName: '', currentStock: 0, minThreshold: 0, maxThreshold: 0, reorderPoint: 0, reorderQuantity: 0, isActive: false },
        minThreshold: 0, maxThreshold: 0, replenishmentFrequency: 'weekly', lastModifiedBy: 'N/A', lastModifiedDate: 'N/A',
      };
      const blocks = buildARSDashboard(config, [], batches);
      await safeRespond(body, respond, { text: `ARS ${activate ? 'activated' : 'deactivated'}`, blocks, replace_original: true });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action(/^ars_request_change_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const value = (action as any).value || '{}';
      const info = typeof value === 'string' ? JSON.parse(value) : value;
      const blocks = buildARSChangeRequestForm(info);
      await safeRespond(body, respond, { text: `Request ARS Change — ${info.productName}`, blocks, replace_original: false });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action(/^ars_submit_change_request_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const userId = body.user.id;
      const { identity, context: ctx } = await pipeline.resolve(userId);
      const stateValues = (body as any).view?.state?.values || (body as any).state?.values || {};
      const reason = stateValues.ars_cr_reason?.ars_cr_reason_val?.value || 'No reason provided';
      const newMinVal = stateValues.ars_cr_new_min?.ars_cr_new_min_val?.value;
      const newMaxVal = stateValues.ars_cr_new_max?.ars_cr_new_max_val?.value;
      const value = (action as any).value || '{}';
      const info = typeof value === 'string' ? JSON.parse(value) : value;
      const newMin = newMinVal ? (parseInt(newMinVal, 10) || info.minStock) : info.minStock;
      const newMax = newMaxVal ? (parseInt(newMaxVal, 10) || info.maxStock) : info.maxStock;
      const crApprovalBlocks = buildARSApprovalMessage(identity.displayName, ctx.accountName, [{ productName: info.productName, oldMin: info.minStock, newMin, oldMax: info.maxStock, newMax }]);
      const salesChannel = process.env.SLACK_SALES_CHANNEL || 'sales';
      try {
        try { await app.client.conversations.join({ channel: salesChannel }); } catch { /* join may not be available */ }
        await app.client.chat.postMessage({
          channel: salesChannel,
          text: `ARS Change Request from ${identity.displayName}: ${info.productName}`,
          blocks: crApprovalBlocks,
        });
        await safeRespond(body, respond, { text: `:white_check_mark: Change request for ${info.productName} submitted to #${salesChannel}.\n*Reason:* ${reason}`, replace_original: false });
      } catch (channelErr: any) {
        logger.warn({ err: channelErr, salesChannel }, 'Could not post ARS change request to channel, falling back to DM');
        try {
          await app.client.chat.postMessage({
            channel: userId,
            text: `ARS Change Request — ${info.productName}\nReason: ${reason}`,
            blocks: crApprovalBlocks,
          });
          await safeRespond(body, respond, { text: `:white_check_mark: Change request for ${info.productName} submitted. Sent to your DMs (invite the bot to #${salesChannel} for direct channel notifications).\n*Reason:* ${reason}`, replace_original: false });
        } catch {
          await safeRespond(body, respond, { text: `:warning: Could not submit change request. Please invite the bot to #${salesChannel} and try again.`, replace_original: false });
        }
      }
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action(/^ars_deactivate_product_/, async ({ ack, body, respond, action }) => {
    await ack();
    try {
      const value = (action as any).value || '{}';
      const info = typeof value === 'string' ? JSON.parse(value) : value;
      await safeRespond(body, respond, { text: `:x: ARS deactivated for *${info.productName}*. Contact your admin to re-enable.`, replace_original: false });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await safeRespond(body, respond, { text: userMessage, replace_original: false }); }
  });

  app.action('ars_approve_changes', async ({ ack, body, respond }) => {
    await ack();
    const messageTs = (body as any).message?.ts;
    if (!messageTs || !pendingARSChanges.has(messageTs)) {
      await safeRespond(body, respond, { text: 'This approval request has expired or was already processed.', replace_original: false });
      return;
    }
    const pending = pendingARSChanges.get(messageTs)!;
    try {
      for (const change of pending.changes) {
        await sfClient.getARSConfig({ salesforceAccountId: pending.accountId } as any);
      }
      const blocks = buildARSApprovalAcknowledgement(true, pending.userName);
      await app.client.chat.postMessage({ channel: pending.channelId, thread_ts: pending.messageTs, text: 'ARS settings approved and applied.', blocks });
      try {
        await app.client.chat.postMessage({ channel: pending.userId, text: ':white_check_mark: Your ARS settings changes have been approved.' });
      } catch { /* DM may fail */ }
      pendingARSChanges.delete(messageTs);
    } catch (err) {
      await safeRespond(body, respond, { text: 'Failed to apply ARS settings.', replace_original: false });
    }
  });

  app.action('ars_reject_changes', async ({ ack, body, respond }) => {
    await ack();
    const messageTs = (body as any).message?.ts;
    if (!messageTs || !pendingARSChanges.has(messageTs)) {
      await safeRespond(body, respond, { text: 'This approval request has expired or was already processed.', replace_original: false });
      return;
    }
    const pending = pendingARSChanges.get(messageTs)!;
    const blocks = buildARSApprovalAcknowledgement(false, pending.userName);
    await app.client.chat.postMessage({ channel: pending.channelId, thread_ts: pending.messageTs, text: 'ARS settings rejected.', blocks });
    try {
      await app.client.chat.postMessage({ channel: pending.userId, text: ':x: Your ARS settings changes have been rejected.' });
    } catch { /* DM may fail */ }
    pendingARSChanges.delete(messageTs);
  });

  app.action('ai_insights_menu', async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id; const { context: ctx } = await pipeline.resolve(userId);
      const insights = await sfClient.getBusinessInsightsEnhanced(ctx);
      const recommendations = await sfClient.getStockThresholdRecommendations(ctx);
      const upsells = await sfClient.getUpsellRecommendations(ctx);
      if (insights.length === 0 && recommendations.length === 0 && upsells.length === 0) {
        await safeRespond(body, respond, { text: 'AI Insights', blocks: buildAIFallback(), replace_original: false });
      } else {
        await safeRespond(body, respond, { text: 'AI Insights', blocks: buildAIInsightsDashboard(insights, recommendations, upsells), replace_original: false });
      }
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: 'AI Insights', blocks: buildAIFallback(), replace_original: false });
    }
  });

  app.action('dms_diagnostics', async ({ ack, body, respond }) => {
    await ack();
    if (process.env.NODE_ENV === 'production') {
      await safeRespond(body, respond, { text: 'Diagnostics are only available in development mode.', replace_original: false });
      return;
    }
    try {
      const userId = body.user.id;
      const { identity, context: ctx } = await pipeline.resolve(userId);
      const mode = getClientMode();
      const instanceUrl = process.env.SALESFORCE_INSTANCE_URL || 'N/A';
      const blocks: any[] = [
        buildHeader(':wrench: DMSFA Diagnostics'),
        buildSection(`*Slack User:* ${identity.displayName} (${identity.slackUserId})\n*Email:* ${identity.email}\n*Team:* ${identity.slackTeamId}`),
        buildDivider(),
        buildSection(`*Salesforce Mode:* ${mode}\n*Instance URL:* ${instanceUrl}\n*Resolved Account:* ${ctx.accountName} (${ctx.salesforceAccountId})\n*Mapping Source:* ${ctx.mappingSource}\n*Account Active:* ${ctx.isActive ? ':white_check_mark: Yes' : ':x: No'}`),
        buildDivider(),
        buildSection(`*Features Blocked:* ${BLOCKERS.length}\n${BLOCKERS.slice(0, 10).map((b) => `\u2022 ${b.id}: ${b.feature}`).join('\n')}`),
        buildDivider(),
        buildContext([`Mode: ${sfClient.isMock() ? 'MOCK' : 'REAL'} | Timestamp: ${new Date().toISOString()}`]),
      ];
      await safeRespond(body, respond, { text: 'Diagnostics', blocks, replace_original: false });
    } catch (err) {
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await safeRespond(body, respond, { text: userMessage, replace_original: false });
    }
  });
}

function buildBackToMenuButton(): any {
  return buildButton(':arrow_left: Back to Menu', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary');
}

function buildEmptyDashboardMetrics() {
  return {
    totalOrders: 0,
    totalOrderValue: 0,
    ordersThisMonth: 0,
    ordersThisMonthValue: 0,
    pendingOrders: 0,
    primaryOrders: 0,
    primaryOrderValue: 0,
    primaryOrdersThisMonth: 0,
    primaryPendingOrders: 0,
    secondaryOrders: 0,
    secondaryOrderValue: 0,
    secondaryOrdersThisMonth: 0,
    secondaryPendingOrders: 0,
    pendingReturns: 0,
    openClaims: 0,
    unpaidInvoices: 0,
    inventoryAlerts: 0,
    monthlyGrowthPercent: 0,
  };
}

function hydrateSelectedFromSlackState(
  selected: Array<{ productId: string; quantity: number; schemeDiscount?: number }>,
  body: any,
) {
  const stateValues = body?.view?.state?.values || body?.state?.values || {};
  return selected.map((item) => {
    const qtyValue = stateValues[`qty_${item.productId}`]?.[`input_qty_${item.productId}`]?.value;
    const quantity = Math.max(1, parseInt(qtyValue || String(item.quantity), 10) || item.quantity || 1);
    return { ...item, quantity, schemeDiscount: 0 };
  });
}
