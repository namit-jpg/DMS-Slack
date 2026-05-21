import { SecondaryOrder, SecondaryOrderDetail, InventoryAvailability, DMSInvoice, DispatchRequest, ArsConfig, ArsTriggeredOrder, BatchStockPolicy, AIBusinessInsight, AIStockRecommendation, AIUpsellRecommendation } from '../../salesforce/types';
import { buildSection, buildDivider, buildHeader, buildButton, buildContext } from './commonBlocks';
import { SLACK_ACTION_IDS } from '../../config/slackConstants';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

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
    element: { type: 'plain_text_input', action_id: 'search_so_input', placeholder: { type: 'plain_text', text: 'Type order number or retailer...', emoji: true }, initial_value: searchTerm || undefined },
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
        text: { type: 'mrkdwn', text: `*${o.orderNumber}* \u2014 ${o.retailerCustomer}\nStatus: ${o.status} | ${invEmoji} Invoice: ${o.invoiceStatus || 'Pending'} | ${dispEmoji} Dispatch: ${o.dispatchStatus || 'Pending'}\nAmount: Rs ${formatCurrency(o.totalAmount)} | Fulfillment: ${o.fulfillmentStatus || 'Not Fulfilled'} | Date: ${o.orderDate || 'N/A'}` },
        accessory: { type: 'button', text: { type: 'plain_text', text: 'View Details', emoji: true }, action_id: `view_so_detail_${o.orderId}`, value: o.orderId },
      });
      blocks.push(buildDivider());
    });
  }
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });
  return blocks;
}

export function buildSecondaryOrderDetail(detail: SecondaryOrderDetail): Block[] {
  const fulfillEmoji = ['Fully Invoiced', 'Fully Fulfilled'].includes(detail.fulfillmentStatus) ? ':white_check_mark:'
    : ['Partially Fulfilled', 'Partially Invoiced'].includes(detail.fulfillmentStatus) ? ':warning:'
    : ':clock3:';

  const blocks: Block[] = [
    buildHeader(`:twisted_rightwards_arrows: SO ${detail.orderNumber}`),
    buildSection(`*Retailer:* ${detail.retailerCustomer}\n*Status:* ${detail.status}\n*Invoice:* ${detail.invoiceStatus}\n*Dispatch:* ${detail.dispatchStatus}\n${fulfillEmoji} *Fulfillment:* ${detail.fulfillmentStatus}\n*Amount:* Rs ${formatCurrency(detail.totalAmount)}`),
    buildDivider(),
    buildSection(`*From:* ${detail.sourceAddress || 'Distributor Warehouse'}\n*To:* ${detail.destinationAddress || 'Retailer Address'}${detail.requestedDeliveryDate ? `\n*Requested Delivery:* ${detail.requestedDeliveryDate}` : ''}`),
    buildDivider(),
    buildSection(`*Products (${detail.items.length})*`),
  ];

  detail.items.forEach((li) => {
    const pct = li.orderedQuantity > 0 ? Math.round((li.fulfilledQuantity / li.orderedQuantity) * 100) : 0;
    const itemEmoji = li.pendingQuantity === 0 ? ':white_check_mark:' : pct > 0 ? ':warning:' : ':clock3:';
    blocks.push(buildSection(
      `${itemEmoji} *${li.productName}*\nOrdered: ${li.orderedQuantity} | Fulfilled: ${li.fulfilledQuantity} | *Pending: ${li.pendingQuantity}*`,
    ));
  });

  blocks.push(buildDivider());

  // Show GRN summary if any GRNs have been created
  if (detail.grnIds.length > 0) {
    blocks.push(buildSection(`:package: *GRN(s) Created:* ${detail.grnIds.length} — goods received and recorded`));
  }

  const actions: any[] = [];
  if (detail.canCreateInvoice) actions.push(buildButton(':receipt: Process Invoice', `process_so_invoice_${detail.orderId}`, detail.orderId, 'primary'));
  if (detail.canUpdateDispatch) {
    actions.push(buildButton(':truck: Mark Delivered', `so_dispatch_deliver_${detail.orderId}`, detail.orderId));
  }
  if (actions.length > 0) blocks.push({ type: 'actions', elements: actions });
  blocks.push({ type: 'actions', elements: [
    buildButton(':twisted_rightwards_arrows: Back to Secondary', 'secondary_orders_menu', 'secondary'),
    buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary'),
  ]});
  return blocks;
}

export function buildInvoiceProcessing(orderId: string, availability: InventoryAvailability[]): Block[] {
  const blocks: Block[] = [buildHeader(':receipt: Process Invoice'), buildSection('Available inventory for pending quantities:'), buildDivider()];
  let canFulfillAll = true;
  let totalToInvoice = 0;
  let totalPending = 0;

  availability.forEach((a, idx) => {
    totalPending += a.orderedQuantity; // orderedQuantity = pendingQty in this context
    totalToInvoice += a.availableQuantity;
    const shortfall = a.availableQuantity < a.orderedQuantity;
    if (shortfall) canFulfillAll = false;
    const statusText = shortfall
      ? `:warning: Shortfall: ${a.orderedQuantity - a.availableQuantity}`
      : ':white_check_mark: Fully available';
    blocks.push(buildSection(`*${idx + 1}. ${a.productName}*\nPending: ${a.orderedQuantity} | In Stock: ${a.availableQuantity} | To Invoice: *${a.availableQuantity}* \u2014 ${statusText}`));
    a.batchDetails.filter((b) => b.quantity > 0).forEach((b) => {
      blocks.push(buildSection(`  _Batch \u2026${b.batchId.slice(-4)}: ${b.quantity} units${b.expiryDate ? ` (exp. ${b.expiryDate})` : ''}_`));
    });
  });

  blocks.push(buildDivider());
  if (totalToInvoice === 0) {
    blocks.push(buildSection(':x: *No stock available* \u2014 cannot process invoice at this time.'));
    blocks.push({ type: 'actions', elements: [
      buildButton(':twisted_rightwards_arrows: Back to Order', `view_so_detail_${orderId}`, orderId),
      buildButton(':arrow_left: Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back'),
    ]});
  } else {
    blocks.push(buildSection(canFulfillAll
      ? ':white_check_mark: *Full invoice will be created* \u2014 all pending quantities available'
      : `:warning: *Partial invoice: ${totalToInvoice} of ${totalPending} units available*`));
    blocks.push({ type: 'actions', elements: [
      buildButton(':white_check_mark: Confirm Invoice', `confirm_so_invoice_${orderId}`, canFulfillAll ? 'full' : 'partial', 'primary'),
      buildButton(':twisted_rightwards_arrows: Back to Order', `view_so_detail_${orderId}`, orderId),
      buildButton(':arrow_left: Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back'),
    ]});
  }
  return blocks;
}

export function buildInvoiceConfirmation(invoice: DMSInvoice, dispatches: DispatchRequest[] = []): Block[] {
  const typeLabel = invoice.fullPartial === 'partial' ? ':warning: Partial Invoice' : ':white_check_mark: Full Invoice';
  const blocks: Block[] = [
    buildHeader(':white_check_mark: Invoice Generated'),
    buildSection(`*Invoice:* ${invoice.invoiceNumber}\n*Type:* ${typeLabel}\n*Status:* ${invoice.status}\n*Amount:* Rs ${formatCurrency(invoice.totalAmount || 0)}`),
    buildDivider(),
  ];

  if (dispatches.length > 0) {
    const d = dispatches[0];
    blocks.push(buildSection(`:truck: *Dispatch Created:* ${d.dispatchName}\nStatus: *${d.status}*\nFrom: ${d.sourceAddress || 'Distributor Warehouse'}\nTo: ${d.destinationAddress || 'Retailer'}`));
    if (invoice.fullPartial === 'partial') {
      blocks.push(buildContext([':information_source: Partial invoice \u2014 process remaining quantities when stock is available.']));
    }
    blocks.push(buildDivider());
    const pendingDispatch = dispatches.find((dp) => dp.status !== 'Delivered');
    if (pendingDispatch && invoice.orderId) {
      blocks.push({ type: 'actions', elements: [
        buildButton(':truck: Mark as Delivered', `so_dispatch_deliver_${invoice.orderId}`, invoice.orderId, 'primary'),
        buildButton(':twisted_rightwards_arrows: View Order', `view_so_detail_${invoice.orderId}`, invoice.orderId!),
      ]});
    }
  } else {
    blocks.push(buildSection(':information_source: Dispatch request will be created automatically. Check back in the order detail.'));
  }

  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });
  return blocks;
}

export function buildGRNEntryForm(
  orderId: string,
  invoiceId: string,
  dispatchName: string,
  lineItems: Array<{ productId: string; productName: string; quantity: number }>,
): Block[] {
  const blocks: Block[] = [
    buildHeader(':package: Record Goods Receipt (GRN)'),
    buildSection(`Dispatch *${dispatchName}* delivered. Enter quantities received for each product.`),
    buildContext([':information_source: *Received* = full quantity accepted | *Lost/Short* = not received | *Damaged* = received but damaged']),
    buildDivider(),
  ];

  lineItems.forEach((item) => {
    blocks.push(buildSection(`*${item.productName}*  —  Invoiced: *${item.quantity}*`));
    blocks.push({
      type: 'input',
      block_id: `grn_lost_${item.productId}`,
      label: { type: 'plain_text', text: `Lost / Short Supply`, emoji: false },
      element: {
        type: 'plain_text_input',
        action_id: 'grn_qty_input',
        placeholder: { type: 'plain_text', text: '0', emoji: false },
        initial_value: '0',
      },
      optional: true,
    });
    blocks.push({
      type: 'input',
      block_id: `grn_dmg_${item.productId}`,
      label: { type: 'plain_text', text: `Damaged`, emoji: false },
      element: {
        type: 'plain_text_input',
        action_id: 'grn_qty_input',
        placeholder: { type: 'plain_text', text: '0', emoji: false },
        initial_value: '0',
      },
      optional: true,
    });
  });

  blocks.push(buildDivider());
  blocks.push({ type: 'actions', elements: [
    buildButton(':white_check_mark: Submit GRN', `submit_grn_${orderId}__${invoiceId}`, `${orderId}__${invoiceId}`, 'primary'),
    buildButton(':x: Skip GRN', `view_so_detail_${orderId}`, orderId),
  ]});
  return blocks;
}

export function buildGRNConfirmation(grnNumber: string, orderId: string, items: Array<{ productName: string; received: number; lost: number; damaged: number }>): Block[] {
  const blocks: Block[] = [
    buildHeader(':white_check_mark: GRN Recorded'),
    buildSection(`*GRN Number:* ${grnNumber}\n\nGoods receipt has been recorded in Salesforce. Status will be updated automatically.`),
    buildDivider(),
  ];
  items.forEach((i) => {
    const parts = [`Received: *${i.received}*`];
    if (i.lost > 0) parts.push(`Lost/Short: *${i.lost}*`);
    if (i.damaged > 0) parts.push(`Damaged: *${i.damaged}*`);
    blocks.push(buildSection(`*${i.productName}*\n${parts.join(' | ')}`));
  });
  blocks.push(buildDivider());
  blocks.push({ type: 'actions', elements: [
    buildButton(':twisted_rightwards_arrows: View Order', `view_so_detail_${orderId}`, orderId),
    buildButton(':arrow_left: Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary'),
  ]});
  return blocks;
}

export function buildDispatchStatusBlocks(dispatches: DispatchRequest[]): Block[] {
  if (dispatches.length === 0) return [buildHeader(':truck: Dispatch Status'), buildSection('No dispatch requests found.'), { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] }];
  const blocks: Block[] = [buildHeader(':truck: Dispatch Status'), buildDivider()];
  dispatches.forEach((d) => blocks.push(buildSection(`*${d.dispatchName}* \u2014 Status: ${d.status}\nFrom: ${d.sourceAddress}\nTo: ${d.destinationAddress}\n${d.startDate || ''} \u2192 ${d.endDate || ''}`)));
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });
  return blocks;
}

// -- ARS Policy --
export function buildARSDashboard(
  config: ArsConfig,
  policies: BatchStockPolicy[],
  searchTerm = '',
): Block[] {
  const filtered = searchTerm
    ? policies.filter((p) => p.productName.toLowerCase().includes(searchTerm.toLowerCase()))
    : policies;
  const belowMin = policies.filter((p) => p.availableStock < p.minStock).length;

  const blocks: Block[] = [
    buildHeader(':gear: ARS — Automatic Replenishment'),
    buildSection(`*Status:* ${config.autoReplenishmentEnabled ? ':white_check_mark: Active' : ':x: Inactive'} | *Products:* ${policies.length} | *Below Min:* ${belowMin}`),
    buildDivider(),
    {
      type: 'input', block_id: 'ars_search_block',
      label: { type: 'plain_text', text: ':mag: Search Product', emoji: true },
      element: { type: 'plain_text_input', action_id: 'ars_search_input', placeholder: { type: 'plain_text', text: 'Type product name...', emoji: true }, initial_value: searchTerm || undefined },
      optional: true,
    },
    { type: 'actions', elements: [
      buildButton(':mag: Search', 'ars_search_button', 'search', 'primary'),
      buildButton(':clipboard: View ARS Orders', 'ars_view_orders', 'orders'),
      buildButton(':leftwards_arrow_with_hook: Back', SLACK_ACTION_IDS.BACK_TO_MENU, 'back'),
    ]},
    buildDivider(),
  ];

  const display = filtered.length > 0 ? filtered.slice(0, 15) : policies.slice(0, 15);
  if (display.length === 0) {
    blocks.push(buildSection('No inventory policies configured. Contact your admin to set up ARS policies.'));
  } else {
    blocks.push(buildSection(`*Policies (${display.length} shown)*`));
    display.forEach((p) => {
      const belowMin = p.availableStock < p.minStock;
      const emoji = belowMin ? ':red_circle:' : ':large_green_circle:';
      blocks.push(buildSection(
        `${emoji} *${p.productName}*\nStock: ${p.availableStock} | Min: ${p.minStock} | Max: ${p.maxStock}`,
      ));
      blocks.push({ type: 'actions', elements: [
        belowMin
          ? buildButton(':shopping_trolley: Create Primary Order', `ars_create_order_${p.productId}`, p.productId, 'primary')
          : buildButton(':memo: Request Change', `ars_request_change_${p.productId}`, JSON.stringify({ productId: p.productId, productName: p.productName, minStock: p.minStock, maxStock: p.maxStock })),
      ]});
    });
  }
  return blocks;
}

export function buildARSOrdersList(orders: ArsTriggeredOrder[]): Block[] {
  const blocks: Block[] = [buildHeader(':clipboard: ARS Replenishment Orders')];
  if (orders.length === 0) {
    blocks.push(buildSection('No orders have been created through ARS yet.'));
  } else {
    blocks.push(buildSection(`*${orders.length} order(s)*`));
    orders.forEach((o) => blocks.push(buildSection(
      `*${o.orderNumber}* — ${o.productName}\nQty: ${o.quantity} | Trigger: ${o.reason}\nStatus: ${o.status} | Date: ${o.triggerDate}`,
    )));
  }
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to ARS', 'ars_menu', 'back')] });
  return blocks;
}

export function buildEnhancedInventoryView(
  products: Array<{ productId: string; productName: string; currentStock: number; minStock: number; maxStock: number; expectedStock: number; location: string }>,
  selectedLocation?: string,
): Block[] {
  const locations = [...new Set(products.map((p) => p.location).filter(Boolean))];
  const filtered = selectedLocation ? products.filter((p) => p.location === selectedLocation) : products;

  const blocks: Block[] = [
    buildHeader(':package: Inventory Visibility'),
    buildSection(`*Products:* ${products.length} | *Locations:* ${locations.length}`),
    buildDivider(),
  ];

  if (locations.length > 0) {
    blocks.push({
      type: 'section',
      block_id: 'inventory_location_select',
      text: { type: 'mrkdwn', text: '*Select Warehouse/Location*' },
      accessory: {
        type: 'static_select',
        action_id: 'inventory_select_location',
        placeholder: { type: 'plain_text', text: selectedLocation || 'All Locations', emoji: true },
        options: [
          { text: { type: 'plain_text', text: 'All Locations', emoji: true }, value: '__all__' },
          ...locations.slice(0, 10).map((l) => ({ text: { type: 'plain_text', text: l, emoji: true }, value: l })),
        ],
      },
    });
    blocks.push(buildDivider());
  }

  if (filtered.length === 0) {
    blocks.push(buildSection('No inventory data available for this location.'));
  } else {
    blocks.push(buildSection('*Stock Status*'));
    filtered.slice(0, 15).forEach((p) => {
      const needed = Math.max(0, p.minStock - p.currentStock);
      const bar = stockBar(p.currentStock, p.maxStock);
      blocks.push(buildSection(
        `*${p.productName}*${p.location ? ` (${p.location})` : ''}\n${bar}\nCurrent: ${p.currentStock} | Min: ${p.minStock} | Max: ${p.maxStock} | Needed: ${needed} | Expected: ${p.expectedStock}`,
      ));
    });
  }
  blocks.push({ type: 'actions', elements: [
    buildButton(':shopping_trolley: Place Replenishment Order', SLACK_ACTION_IDS.SELECT_ORDER_TYPE, 'create', 'primary'),
    buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back'),
  ]});
  return blocks;
}

function stockBar(current: number, max: number): string {
  const pct = Math.min(100, Math.round((current / Math.max(1, max)) * 100));
  const filled = Math.round(pct / 10);
  return `[\`${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\`] ${pct}%`;
}

export function buildARSEditProduct(productInfo: { productId: string; productName: string; batchNumber: string; minStock: number; maxStock: number; availableStock: number }): Block[] {
  return [
    buildHeader(`:pencil2: Edit ARS — ${productInfo.productName}`),
    buildSection(`*Batch:* ${productInfo.batchNumber}\n*Current Stock:* ${productInfo.availableStock}\n*Current Min:* ${productInfo.minStock} | *Current Max:* ${productInfo.maxStock}`),
    buildDivider(),
    {
      type: 'input', block_id: 'ars_edit_min',
      label: { type: 'plain_text', text: 'Minimum Stock Quantity', emoji: true },
      element: { type: 'plain_text_input', action_id: 'ars_edit_min_val', initial_value: String(productInfo.minStock) },
    },
    {
      type: 'input', block_id: 'ars_edit_max',
      label: { type: 'plain_text', text: 'Maximum Stock Quantity', emoji: true },
      element: { type: 'plain_text_input', action_id: 'ars_edit_max_val', initial_value: String(productInfo.maxStock) },
    },
    buildDivider(),
    { type: 'actions', elements: [
      buildButton(':envelope: Submit for Approval', `ars_submit_product_${productInfo.productId}`, JSON.stringify(productInfo), 'primary'),
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
      label: { type: 'plain_text', text: 'Reason for Change', emoji: true },
      element: { type: 'plain_text_input', action_id: 'ars_cr_reason_val', multiline: true, placeholder: { type: 'plain_text', text: 'Describe why you need this change...', emoji: true } },
    },
    {
      type: 'input', block_id: 'ars_cr_new_min', optional: true,
      label: { type: 'plain_text', text: 'Requested Min Stock (leave blank to keep current)', emoji: true },
      element: { type: 'plain_text_input', action_id: 'ars_cr_new_min_val', initial_value: String(productInfo.minStock) },
    },
    {
      type: 'input', block_id: 'ars_cr_new_max', optional: true,
      label: { type: 'plain_text', text: 'Requested Max Stock (leave blank to keep current)', emoji: true },
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
    buildSection(`*Requested by:* ${userName}\n*Distributor:* ${accountName}\n*Timestamp:* ${formatDateTime()}`),
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
    upsells.forEach((u) => blocks.push(buildSection(`:dart: *${u.retailerName}* \u2192 ${u.productName}\n${u.reason}\nOpportunity Score: ${u.opportunityScore}/100 | Est. Revenue: Rs ${formatCurrency(u.estimatedRevenue)}`)));
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
