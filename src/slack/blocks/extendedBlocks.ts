import { SecondaryOrder, SecondaryOrderDetail, InventoryAvailability, DMSInvoice, DispatchRequest, SecondaryOrderGRN, ArsConfig, ArsTriggeredOrder, BatchStockPolicy, AIBusinessInsight, AIStockRecommendation, AIUpsellRecommendation } from '../../salesforce/types';
import { buildSection, buildDivider, buildHeader, buildButton, buildContext } from './commonBlocks';
import { SLACK_ACTION_IDS } from '../../config/slackConstants';

type Block = any;

// -- Secondary Orders --
export function buildSecondaryOrderList(orders: SecondaryOrder[]): Block[] {
  if (orders.length === 0) return [buildHeader(':twisted_rightwards_arrows: Secondary Orders'), buildSection('No secondary orders found.'), { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] }];
  const blocks: Block[] = [buildHeader(':twisted_rightwards_arrows: Secondary Orders'), buildDivider()];
  orders.slice(0, 15).forEach((o) => {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${o.orderNumber}* \u2014 ${o.retailerCustomer}\nStatus: ${o.status} | Invoice: ${o.invoiceStatus} | Dispatch: ${o.dispatchStatus}\nAmount: Rs ${o.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} | Fulfillment: ${o.fulfillmentStatus}` }, accessory: { type: 'button', text: { type: 'plain_text', text: 'View Details' }, action_id: `view_so_detail_${o.orderId}`, value: o.orderId } });
    blocks.push(buildDivider());
  });
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });
  return blocks;
}

export function buildSecondaryOrderDetail(detail: SecondaryOrderDetail): Block[] {
  const blocks: Block[] = [buildHeader(`:twisted_rightwards_arrows: SO ${detail.orderNumber}`), buildSection(`*Retailer:* ${detail.retailerCustomer}\n*Status:* ${detail.status}\n*Invoice:* ${detail.invoiceStatus}\n*Dispatch:* ${detail.dispatchStatus}\n*Fulfillment:* ${detail.fulfillmentStatus}\n*Amount:* Rs ${detail.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`), buildDivider(), buildSection(`*From:* ${detail.sourceAddress}\n*To:* ${detail.destinationAddress}${detail.requestedDeliveryDate ? `\n*Requested Delivery:* ${detail.requestedDeliveryDate}` : ''}`), buildDivider(), buildSection(`*Products (${detail.items.length})*`)];
  detail.items.forEach((li) => blocks.push(buildSection(`*${li.productName}* \u2014 Ord: ${li.orderedQuantity} | Avail: ${li.availableQuantity} | Fulfilled: ${li.fulfilledQuantity} | Pending: ${li.pendingQuantity}`)));
  blocks.push(buildDivider());
  const actions: any[] = [];
  if (detail.canCreateInvoice) actions.push(buildButton(':receipt: Process Invoice', `process_so_invoice_${detail.orderId}`, detail.orderId, 'primary'));
  if (detail.canUpdateDispatch && detail.dispatchStatus === 'Pending') actions.push(buildButton(':truck: Mark Delivered', `so_dispatch_deliver_${detail.orderId}`, detail.orderId));
  if (actions.length > 0) blocks.push({ type: 'actions', elements: actions });
  blocks.push({ type: 'actions', elements: [
    buildButton(':twisted_rightwards_arrows: Back to Secondary', 'secondary_orders_menu', 'secondary'),
    buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary'),
  ] });
  return blocks;
}

export function buildInvoiceProcessing(orderId: string, availability: InventoryAvailability[]): Block[] {
  const blocks: Block[] = [buildHeader(':receipt: Process Invoice for ' + orderId), buildSection('Stock availability for this order:'), buildDivider()];
  let canFulfillAll = true;
  availability.forEach((a, idx) => {
    const shortfall = a.orderedQuantity > a.availableQuantity;
    if (shortfall) canFulfillAll = false;
    blocks.push(buildSection(`*${idx + 1}. ${a.productName}*\nOrdered: ${a.orderedQuantity} | Available: ${a.availableQuantity} | ${shortfall ? `:warning: Shortfall: ${a.orderedQuantity - a.availableQuantity}` : ':white_check_mark: Can fulfill'}`));
    a.batchDetails.forEach((b) => blocks.push(buildSection(`  _Batch ${b.batchId.slice(-4)}: ${b.quantity} units${b.expiryDate ? ` (Expires: ${b.expiryDate})` : ''}_`)));
  });
  blocks.push(buildDivider());
  blocks.push(buildSection(canFulfillAll ? ':white_check_mark: *Full invoice will be created*' : ':warning: *Partial invoice will be created* (pending: pending quantities)'));
  blocks.push({ type: 'actions', elements: [
    buildButton(':white_check_mark: Confirm Invoice', `confirm_so_invoice_${orderId}`, canFulfillAll ? 'full' : 'partial', 'primary'),
    buildButton(':twisted_rightwards_arrows: Back to Order', `view_so_detail_${orderId}`, orderId),
    buildButton(':arrow_left: Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back'),
  ] });
  return blocks;
}

export function buildInvoiceConfirmation(invoice: DMSInvoice): Block[] {
  return [buildHeader(':white_check_mark: Invoice Generated'), buildSection(`*Invoice:* ${invoice.invoiceNumber}\n*Type:* ${invoice.fullPartial === 'partial' ? 'Partial' : 'Full'}\n*Status:* ${invoice.status}\n*Amount:* Rs ${(invoice.totalAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`), { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] }];
}

export function buildDispatchStatusBlocks(dispatches: DispatchRequest[]): Block[] {
  if (dispatches.length === 0) return [buildHeader(':truck: Dispatch Status'), buildSection('No dispatch requests found.'), { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] }];
  const blocks: Block[] = [buildHeader(':truck: Dispatch Status'), buildDivider()];
  dispatches.forEach((d) => blocks.push(buildSection(`*${d.dispatchName}* \u2014 Status: ${d.status}\nFrom: ${d.sourceAddress}\nTo: ${d.destinationAddress}\n${d.startDate || ''} \u2192 ${d.endDate || ''}`)));
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });
  return blocks;
}

// -- ARS --
export function buildARSDashboard(config: ArsConfig, triggeredOrders: ArsTriggeredOrder[], batches: BatchStockPolicy[]): Block[] {
  const blocks: Block[] = [
    buildHeader(':gear: ARS Dashboard'),
    buildSection(`*Mode:* Read-only\n*Default Order Status:* ${config.replenishmentFrequency}\n*Include In Transit:* ${config.autoReplenishmentEnabled ? 'Yes' : 'No'}\n*Last Modified:* ${config.lastModifiedBy} (${config.lastModifiedDate || 'N/A'})`),
    buildDivider(),
    buildSection('ARS settings are shown from Salesforce metadata and inventory batch records. Updates are disabled until a writable Salesforce ARS endpoint is available.'),
    buildDivider(),
  ];

  if (triggeredOrders.length > 0) {
    blocks.push(buildDivider());
    blocks.push(buildSection('*Triggered Replenishment Orders:*'));
    triggeredOrders.forEach((o) => blocks.push(buildSection(`*${o.orderNumber}* \u2014 ${o.productName}\nQty: ${o.quantity} | Reason: ${o.reason}\nStock: ${o.currentStock} (Min: ${o.minThreshold}) | Status: ${o.status}`)));
  }

  if (batches.length > 0) {
    blocks.push(buildDivider());
    blocks.push(buildSection('*Batch-wise Stock:*'));
    batches.forEach((b) => {
      const emoji = b.replenishmentStatus === 'Below Min' ? ':red_circle:' : b.replenishmentStatus === 'Warning' ? ':yellow_circle:' : ':green_circle:';
      blocks.push(buildSection(`${emoji} *${b.batchNumber}* \u2014 ${b.productName}\nStock: ${b.availableStock} (Min: ${b.minStock} / Max: ${b.maxStock})${b.expiryDate ? ` | Expires: ${b.expiryDate}` : ''}\nStatus: ${b.replenishmentStatus}`));
    });
  }
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });
  return blocks;
}

// -- AI Insights --
export function buildAIInsightsDashboard(insights: AIBusinessInsight[], recommendations: AIStockRecommendation[], upsells: AIUpsellRecommendation[]): Block[] {
  const blocks: Block[] = [buildHeader(':bulb: AI-Powered Insights'), buildContext([':robot_face: Generated by existing Salesforce AI/RCG capabilities'])];
  blocks.push(buildDivider());
  blocks.push(buildSection('*Business Summary*'));

  const perfInsights = insights.filter((i) => i.type === 'performance');
  const warnInsights = insights.filter((i) => i.type === 'warning');
  const oppInsights = insights.filter((i) => i.type === 'opportunity');
  const recInsights = insights.filter((i) => i.type === 'recommendation');

  if (perfInsights.length > 0) { perfInsights.forEach((i) => blocks.push(buildSection(`:chart_with_upwards_trend: *${i.title}*\n${i.description}\n_${i.metric || ''}_`))); blocks.push(buildDivider()); }
  if (warnInsights.length > 0) { warnInsights.forEach((i) => blocks.push(buildSection(`:warning: *${i.title}*\n${i.description}\n_${i.metric || ''}_`))); blocks.push(buildDivider()); }
  if (oppInsights.length > 0) { blocks.push(buildSection('*Upsell & Retailer Opportunities*')); oppInsights.forEach((i) => blocks.push(buildSection(`:star: *${i.title}*\n${i.description}\n_${i.metric || ''}_`))); blocks.push(buildDivider()); }

  if (recommendations.length > 0) {
    blocks.push(buildSection('*Stock Threshold Suggestions*'));
    recommendations.forEach((r) => blocks.push(buildSection(`:bulb: *${r.productName}*\nMin: ${r.currentMinThreshold} \u2192 *${r.suggestedMinThreshold}* | Max: ${r.currentMaxThreshold} \u2192 *${r.suggestedMaxThreshold}*\n${r.reasoning}\nConfidence: ${Math.round(r.confidence * 100)}%${!r.applied ? '' : ' (Applied)'}`)));
    if (recommendations.some((r) => !r.applied)) blocks.push({ type: 'actions', elements: [buildButton(':white_check_mark: Apply Recommendation', 'apply_ai_threshold_' + recommendations[0].recommendationId, recommendations[0].recommendationId, 'primary')] });
    blocks.push(buildDivider());
  }

  if (upsells.length > 0) {
    blocks.push(buildSection('*Growth Recommendations*'));
    upsells.forEach((u) => blocks.push(buildSection(`:dart: *${u.retailerName}* \u2192 ${u.productName}\n${u.reason}\nOpportunity Score: ${u.opportunityScore}/100 | Est. Revenue: Rs ${u.estimatedRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`)));
  }

  blocks.push(buildDivider());
  blocks.push(buildContext([':information_source: AI insights are advisory. Final decisions rest with you. Data refreshed periodically from Salesforce.']));
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });
  return blocks;
}

export function buildAIRecommendationApplied(rec: AIStockRecommendation): Block[] {
  return [buildHeader(':white_check_mark: Recommendation Applied'), buildSection(`*${rec.productName}*\nNew Min: *${rec.suggestedMinThreshold}* | New Max: *${rec.suggestedMaxThreshold}*\n${rec.reasoning}`), { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] }];
}

export function buildAIFallback(): Block[] {
  return [buildHeader(':bulb: AI Insights'), buildSection('AI-powered insights and recommendations are not available through existing Salesforce APIs.\n\nShowing basic dashboard metrics based on your order and inventory data instead.'), buildContext([':information_source: This feature requires documented Agentforce/Einstein API endpoints (BLK-009).']), { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] }];
}
