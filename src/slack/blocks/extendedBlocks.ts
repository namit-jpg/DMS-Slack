import { SecondaryOrder, SecondaryOrderDetail, InventoryAvailability, DMSInvoice, DispatchRequest, SecondaryOrderGRN, ArsConfig, ArsTriggeredOrder, BatchStockPolicy, AIBusinessInsight, AIStockRecommendation, AIUpsellRecommendation } from '../../salesforce/types';
import { buildSection, buildDivider, buildHeader, buildButton, buildContext } from './commonBlocks';
import { SLACK_ACTION_IDS } from '../../config/slackConstants';

type Block = any;

// -- Secondary Orders --
export function buildSecondaryOrderList(orders: SecondaryOrder[], searchTerm = ''): Block[] {
  const filtered = searchTerm
    ? orders.filter((o) => o.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) || o.retailerCustomer.toLowerCase().includes(searchTerm.toLowerCase()))
    : orders;
  if (orders.length === 0) return [buildHeader(':twisted_rightwards_arrows: Secondary Orders'), buildSection('No secondary orders found.'), { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] }];
  const blocks: Block[] = [buildHeader(':twisted_rightwards_arrows: Secondary Orders'), buildDivider()];
  blocks.push({
    type: 'input',
    block_id: 'so_search_block',
    label: { type: 'plain_text', text: ':mag: Search Secondary Orders', emoji: true },
    element: { type: 'plain_text_input', action_id: 'search_so_input', placeholder: { type: 'plain_text', text: 'Type order number or retailer...' }, initial_value: searchTerm || undefined },
    optional: true,
  });
  blocks.push({ type: 'actions', elements: [buildButton(':mag: Search', 'search_so_button', 'search', 'primary')] });
  blocks.push(buildDivider());
  if (filtered.length === 0) {
    blocks.push(buildSection(`No orders match "${searchTerm}".`));
  } else {
    filtered.slice(0, 15).forEach((o) => {
      const invEmoji = o.invoiceStatus === 'Invoiced' ? ':receipt:' : o.invoiceStatus === 'Partial' ? ':page_facing_up:' : ':clipboard:';
      const dispEmoji = o.dispatchStatus === 'Delivered' ? ':truck:' : o.dispatchStatus === 'Pending' ? ':package:' : ':hourglass:';
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${o.orderNumber}* \u2014 ${o.retailerCustomer}\nStatus: ${o.status} | ${invEmoji} Invoice: ${o.invoiceStatus || 'Pending'} | ${dispEmoji} Dispatch: ${o.dispatchStatus || 'Pending'}\nAmount: Rs ${o.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} | Fulfillment: ${o.fulfillmentStatus || 'Not Fulfilled'}` },
        accessory: { type: 'button', text: { type: 'plain_text', text: 'View Details' }, action_id: `view_so_detail_${o.orderId}`, value: o.orderId },
      });
      blocks.push(buildDivider());
    });
  }
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
export function buildARSDashboard(config: ArsConfig, triggeredOrders: ArsTriggeredOrder[], batches: BatchStockPolicy[], searchTerm = ''): Block[] {
  // Search-first design: main view is minimal (8 blocks max).
  // Action buttons only appear on filtered search results (max 10 products).
  const filtered = searchTerm
    ? batches.filter((b) =>
        b.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.batchNumber.toLowerCase().includes(searchTerm.toLowerCase()))
    : [];

  const statusLabel = config.autoReplenishmentEnabled ? ':white_check_mark: Active' : ':x: Inactive';
  const below = batches.filter((b) => b.replenishmentStatus === 'Below Min').length;
  const warning = batches.filter((b) => b.replenishmentStatus === 'Warning').length;

  const blocks: Block[] = [
    buildHeader(':gear: ARS Dashboard'),
    buildSection(
      `*Status:* ${statusLabel}  |  *Batches:* ${batches.length}` +
      (below > 0 ? `  |  :red_circle: Below Min: ${below}` : '') +
      (warning > 0 ? `  |  :yellow_circle: Warning: ${warning}` : ''),
    ),
    buildDivider(),
    {
      type: 'input',
      block_id: 'ars_search_block',
      label: { type: 'plain_text', text: ':mag: Search to Edit a Product', emoji: true },
      element: {
        type: 'plain_text_input',
        action_id: 'ars_search_input',
        placeholder: { type: 'plain_text', text: 'Type product name or batch number...' },
        initial_value: searchTerm || undefined,
      },
      optional: true,
    },
    {
      type: 'actions',
      elements: [
        buildButton(':mag: Search', 'ars_search_button', 'search', 'primary'),
        config.autoReplenishmentEnabled
          ? buildButton(':x: Deactivate ARS', 'ars_toggle_status', 'deactivate', 'danger')
          : buildButton(':white_check_mark: Activate ARS', 'ars_toggle_status', 'activate', 'primary'),
        buildButton(':arrow_left: Back', SLACK_ACTION_IDS.BACK_TO_MENU, 'back'),
      ],
    },
    buildDivider(),
  ];

  if (!searchTerm) {
    // No search yet — show compact summary grouped by status
    const groups: Record<string, string[]> = {};
    batches.slice(0, 30).forEach((b) => {
      const key = b.replenishmentStatus || 'OK';
      if (!groups[key]) groups[key] = [];
      groups[key].push(b.productName);
    });
    if (batches.length === 0) {
      blocks.push(buildSection('No batch stock data available.'));
    } else {
      const lines = Object.entries(groups).map(([status, names]) => {
        const emoji = status === 'Below Min' ? ':red_circle:' : status === 'Warning' ? ':yellow_circle:' : ':green_circle:';
        return `${emoji} *${status}* (${names.length}): ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` +${names.length - 5} more` : ''}`;
      });
      blocks.push(buildSection(lines.join('\n')));
      if (batches.length > 30) {
        blocks.push(buildContext([`Showing summary of first 30 of ${batches.length} batches. Search to find specific products.`]));
      }
    }
  } else if (filtered.length === 0) {
    blocks.push(buildSection(`No products match _"${searchTerm}"_.`));
  } else {
    // Show up to 10 search results WITH action buttons
    const visible = filtered.slice(0, 10);
    blocks.push(buildSection(`*${visible.length}${filtered.length > 10 ? ` of ${filtered.length}` : ''} result${visible.length !== 1 ? 's' : ''} for "${searchTerm}"*`));
    visible.forEach((b) => {
      const emoji = b.replenishmentStatus === 'Below Min' ? ':red_circle:' : b.replenishmentStatus === 'Warning' ? ':yellow_circle:' : ':green_circle:';
      const batchValue = JSON.stringify({ productId: b.productId, productName: b.productName, batchNumber: b.batchNumber, minStock: b.minStock, maxStock: b.maxStock, availableStock: b.availableStock });
      blocks.push(buildSection(
        `${emoji} *${b.productName}* (${b.batchNumber})\nStock: ${b.availableStock} | Min: ${b.minStock} | Max: ${b.maxStock}${b.expiryDate ? ' | Exp: ' + b.expiryDate : ''}`,
      ));
      blocks.push({
        type: 'actions',
        elements: [
          buildButton(':pencil2: Edit', `ars_edit_product_${b.productId}`, batchValue),
          buildButton(':memo: Request Change', `ars_request_change_${b.productId}`, batchValue),
          buildButton(':x: Deactivate', `ars_deactivate_product_${b.productId}`, batchValue, 'danger'),
        ],
      });
    });
    if (filtered.length > 10) {
      blocks.push(buildContext([`${filtered.length - 10} more results — refine your search to narrow down.`]));
    }
  }

  return blocks;
}

export function buildARSEditProduct(productInfo: { productId: string; productName: string; batchNumber: string; minStock: number; maxStock: number; availableStock: number }): Block[] {
  return [
    buildHeader(`:pencil2: Edit ARS — ${productInfo.productName}`),
    buildSection(`*Batch:* ${productInfo.batchNumber}\n*Current Stock:* ${productInfo.availableStock}\n*Current Min:* ${productInfo.minStock} | *Current Max:* ${productInfo.maxStock}`),
    buildDivider(),
    {
      type: 'input', block_id: 'ars_edit_min',
      label: { type: 'plain_text', text: 'Minimum Stock Quantity' },
      element: { type: 'plain_text_input', action_id: 'ars_edit_min_val', initial_value: String(productInfo.minStock) },
    },
    {
      type: 'input', block_id: 'ars_edit_max',
      label: { type: 'plain_text', text: 'Maximum Stock Quantity' },
      element: { type: 'plain_text_input', action_id: 'ars_edit_max_val', initial_value: String(productInfo.maxStock) },
    },
    buildDivider(),
    { type: 'actions', elements: [
      buildButton(':envelope: Submit for Approval', `ars_submit_product_${productInfo.productId}`, productInfo.productId, 'primary'),
      buildButton(':arrow_left: Back to ARS', 'ars_menu', 'back'),
    ]},
  ];
}

export function buildARSChangeRequestForm(productInfo: { productId: string; productName: string; batchNumber: string; minStock: number; maxStock: number }): Block[] {
  return [
    buildHeader(`:memo: Request ARS Change — ${productInfo.productName}`),
    buildSection(`*Batch:* ${productInfo.batchNumber}\n*Current Min:* ${productInfo.minStock} | *Current Max:* ${productInfo.maxStock}`),
    buildDivider(),
    {
      type: 'input', block_id: 'ars_cr_reason',
      label: { type: 'plain_text', text: 'Reason for Change' },
      element: { type: 'plain_text_input', action_id: 'ars_cr_reason_val', multiline: true, placeholder: { type: 'plain_text', text: 'Describe why you need this change...' } },
    },
    {
      type: 'input', block_id: 'ars_cr_new_min', optional: true,
      label: { type: 'plain_text', text: 'Requested Min Stock (leave blank to keep current)' },
      element: { type: 'plain_text_input', action_id: 'ars_cr_new_min_val', initial_value: String(productInfo.minStock) },
    },
    {
      type: 'input', block_id: 'ars_cr_new_max', optional: true,
      label: { type: 'plain_text', text: 'Requested Max Stock (leave blank to keep current)' },
      element: { type: 'plain_text_input', action_id: 'ars_cr_new_max_val', initial_value: String(productInfo.maxStock) },
    },
    buildDivider(),
    { type: 'actions', elements: [
      buildButton(':envelope: Submit Request', `ars_submit_change_request_${productInfo.productId}`, JSON.stringify(productInfo), 'primary'),
      buildButton(':arrow_left: Back to ARS', 'ars_menu', 'back'),
    ]},
  ];
}

export function buildARSApprovalMessage(userName: string, accountName: string, changes: Array<{ productName: string; oldMin: number; newMin: number; oldMax: number; newMax: number }>): Block[] {
  const blocks: Block[] = [
    buildHeader(':gear: ARS Settings Change Request'),
    buildSection(`*Requested by:* ${userName}\n*Distributor:* ${accountName}\n*Timestamp:* ${new Date().toLocaleString()}`),
    buildDivider(),
    buildSection('*Requested Changes:*'),
  ];
  changes.forEach((c) => {
    blocks.push(buildSection(`*${c.productName}*\nMin: ${c.oldMin} \u2192 *${c.newMin}* | Max: ${c.oldMax} \u2192 *${c.newMax}*`));
  });
  blocks.push(buildDivider());
  blocks.push(buildSection(':warning: *Action Required:* Approve or reject these changes.'));
  blocks.push({ type: 'actions', elements: [
    buildButton(':white_check_mark: Approve', 'ars_approve_changes', 'approve', 'primary'),
    buildButton(':x: Reject', 'ars_reject_changes', 'reject', 'danger'),
  ]});
  return blocks;
}

export function buildARSApprovalAcknowledgement(approved: boolean, userName: string): Block[] {
  if (approved) {
    return [buildHeader(':white_check_mark: ARS Settings Applied'), buildSection(`ARS settings changes submitted by *${userName}* have been applied.`)];
  }
  return [buildHeader(':x: ARS Settings Rejected'), buildSection(`ARS settings changes submitted by *${userName}* have been rejected.`)];
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
