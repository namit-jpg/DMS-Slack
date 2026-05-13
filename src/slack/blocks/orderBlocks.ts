import { DMSProduct, PrimaryOrderQuote, PrimaryOrder, PrimaryOrderDetail, GRNPayload, GRNResult, ReturnOrder, ReturnOrderDetail, Claim, ApprovalStatus, ApprovalResult, CreditNote } from '../../salesforce/types';
import { buildSection, buildDivider, buildHeader, buildButton, buildContext } from './commonBlocks';
import { SLACK_ACTION_IDS } from '../../config/slackConstants';

type Block = any;

export function buildProductSelectionModal(
  products: DMSProduct[],
  selected: Array<{ productId: string; quantity: number; schemeDiscount?: number }>,
): Block[] {
  const blocks: Block[] = [buildHeader(':shopping_trolley: Create Primary Order')];
  if (selected.length > 0) {
    blocks.push(buildSection('*Selected Products*'));
    selected.forEach((s, idx) => {
      const p = products.find((pp) => pp.productId === s.productId);
      const qty = Math.max(1, s.quantity || p?.minOrderQtyPrimary || 1);
      blocks.push(buildSection(`*${idx + 1}. ${p?.productName || s.productId}* (${p?.productCode || ''})\nUnit price: Rs ${p ? p.unitPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'} | Estimated line: Rs ${p ? (p.unitPrice * qty).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}`));
      blocks.push({
        type: 'input',
        block_id: `qty_${s.productId}`,
        label: { type: 'plain_text', text: `Quantity for ${p?.productName || s.productId}`.slice(0, 150), emoji: true },
        element: { type: 'plain_text_input', action_id: `input_qty_${s.productId}`, initial_value: String(qty) },
      });
    });
    blocks.push(buildDivider());
    blocks.push({ type: 'actions', elements: [buildButton(':white_check_mark: Review Order', 'review_order_quote', 'review', 'primary')] });
    blocks.push(buildDivider());
  }
  blocks.push(buildSection('Available products (click to select):'));
  blocks.push({
    type: 'input',
    block_id: 'product_search_block',
    label: { type: 'plain_text', text: ':mag: Search Products', emoji: true },
    element: { type: 'plain_text_input', action_id: 'search_products_input', placeholder: { type: 'plain_text', text: 'Type product name or code...', emoji: true } },
    optional: true,
  });
  blocks.push({ type: 'actions', elements: [buildButton(':mag: Search', 'search_products_button', 'search', 'primary')] });
  blocks.push(buildDivider());
  products.slice(0, 10).forEach((p) => {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${p.productName}* (${p.productCode})\n${p.family} | Unit: ${p.unitOfMeasure} | Rs ${p.unitPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/unit | Min Qty: ${p.minOrderQtyPrimary ?? 'No minimum'}` },
      accessory: { type: 'button', text: { type: 'plain_text', text: 'Add', emoji: true }, action_id: `add_product_${p.productId}`, value: p.productId },
    });
    blocks.push(buildDivider());
  });
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back')] });
  return blocks;
}

export function buildOrderQuoteReview(quote: PrimaryOrderQuote): Block[] {
  const blocks: Block[] = [
    buildHeader(':receipt: Order Quote Review'),
    buildSection(`*Quote ID:* ${quote.quoteId}\n*Currency:* ${quote.currency}\n*Valid until:* ${new Date(quote.expiresAt).toLocaleTimeString()}`),
    buildDivider(),
  ];
  quote.lineItems.forEach((li, idx) => {
    blocks.push(buildSection(`*${idx + 1}. ${li.productName}* (${li.productCode})\nQty: ${li.quantity} x Rs ${li.unitPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })} = Rs ${li.totalPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`));
  });
  blocks.push(buildDivider());
  blocks.push(buildSection(
    `*Subtotal:* Rs ${quote.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n` +
    (quote.schemeDiscount > 0 ? `*Scheme Discount:* -Rs ${quote.schemeDiscount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}${quote.appliedSchemes.length > 0 ? ` (${quote.appliedSchemes.join(', ')})` : ''}\n` : '') +
    (quote.discountAmount > 0 ? `*Discount:* -Rs ${quote.discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n` : '') +
    ((quote.creditApplied || 0) > 0 ? `*Credit Notes Applied:* -Rs ${quote.creditApplied.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n` : '') +
    (quote.taxAmount > 0 ? `*Tax:* Rs ${quote.taxAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n` : '') +
    `*Grand Total:* Rs ${quote.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
  ));
  const availableCreditNotes = (quote.eligibleCreditNotes || []).filter((note) => (note.availableAmount ?? note.amount) > 0);
  if (availableCreditNotes.length > 0) {
    blocks.push({
      type: 'input',
      block_id: 'credit_notes',
      label: { type: 'plain_text', text: 'Apply credit notes', emoji: true },
      optional: true,
      element: {
        type: 'checkboxes',
        action_id: 'select_credit_notes',
        options: availableCreditNotes.slice(0, 10).map((note) => ({
          text: {
            type: 'plain_text',
            text: `${note.creditNoteNumber} - Rs ${(note.availableAmount ?? note.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            emoji: true,
          },
          value: note.creditNoteId,
        })),
      },
    });
  } else {
    blocks.push(buildContext(['No available credit notes found for this distributor.']));
  }
  if ((quote.appliedCreditNotes || []).length > 0) {
    blocks.push(buildSection(`*Credit Notes*\n${quote.appliedCreditNotes.map((note) => `${note.creditNoteNumber}: Rs ${note.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`).join('\n')}`));
  }
  blocks.push({ type: 'actions', elements: [
    buildButton(':white_check_mark: Confirm Order', SLACK_ACTION_IDS.SUBMIT_PRIMARY_ORDER, 'confirm_order', 'primary'),
    buildButton(':arrow_left: Back to Products', SLACK_ACTION_IDS.SELECT_ORDER_TYPE, 'back_products'),
    buildButton(':x: Cancel', SLACK_ACTION_IDS.CANCEL_ACTION, 'cancel_quote', 'danger'),
  ]});
  blocks.push(buildContext(['Quote expires in 30 minutes. Prices may change if quote expires.']));
  return blocks;
}

export function buildOrderConfirmation(order: PrimaryOrder): Block[] {
  return [
    buildHeader(':white_check_mark: Order Created Successfully!'),
    buildSection(`*Order Number:* ${order.orderNumber}\n*Status:* ${order.status}\n*Date:* ${order.orderDate}\n*Grand Total:* Rs ${order.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`),
    buildDivider(),
    buildSection(`*Items (${order.items.length})*`),
    ...order.items.map((li) => buildSection(`*${li.productName}* \u2014 ${li.quantity} x Rs ${li.unitPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })} = Rs ${li.totalPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`)),
    buildDivider(),
    buildSection(`*Scheme Discount:* Rs ${order.schemeDiscount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n*Approval Status:* ${order.approvalStatus || 'N/A'}`),
    (order.creditApplied || 0) > 0 ? buildSection(`*Credit Applied:* Rs ${(order.creditApplied || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`) : buildContext(['No credit notes were applied.']),
    buildContext(['Your order has been created. Track it from My Primary Orders.']),
    { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] },
  ];
}

export function buildOrderListBlocks(orders: PrimaryOrder[], searchTerm = ''): Block[] {
  const filtered = searchTerm
    ? orders.filter((o) => o.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()))
    : orders;
  if (orders.length === 0) return [buildHeader(':clipboard: My Primary Orders'), buildSection('No orders found.'), { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] }];
  const blocks: Block[] = [buildHeader(':clipboard: My Primary Orders'), buildDivider()];
  blocks.push({ type: 'actions', elements: [
    buildButton(':pencil: New Order', SLACK_ACTION_IDS.SELECT_ORDER_TYPE, 'create', 'primary'),
    buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back'),
  ]});
  blocks.push(buildDivider());
  blocks.push({
    type: 'input',
    block_id: 'order_search_block',
    label: { type: 'plain_text', text: ':mag: Search Orders', emoji: true },
    element: { type: 'plain_text_input', action_id: 'search_orders_input', placeholder: { type: 'plain_text', text: 'Type order number...', emoji: true }, initial_value: searchTerm || undefined },
    optional: true,
  });
  blocks.push({ type: 'actions', elements: [buildButton(':mag: Search', 'search_orders_button', 'search', 'primary')] });
  blocks.push(buildDivider());
  if (filtered.length === 0) {
    blocks.push(buildSection(`No orders match "${searchTerm}".`));
  } else {
    filtered.slice(0, 15).forEach((o) => {
      const emoji = o.status === 'Approved' ? ':white_check_mark:' : o.status === 'Pending' ? ':hourglass_flowing_sand:' : o.status === 'Draft' ? ':pencil2:' : ':grey_question:';
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `${emoji} *${o.orderNumber}*\nStatus: ${o.status} | Total: Rs ${o.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })} | Date: ${o.orderDate}\nApproval: ${o.approvalStatus || 'N/A'}` },
        accessory: { type: 'button', text: { type: 'plain_text', text: 'View Details', emoji: true }, action_id: `view_po_detail_${o.orderId}`, value: o.orderId },
      });
      blocks.push(buildDivider());
    });
  }
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });
  return blocks;
}

export function buildOrderDetailBlocks(detail: PrimaryOrderDetail): Block[] {
  const blocks: Block[] = [
    buildHeader(`:clipboard: Order ${detail.orderNumber}`),
    buildSection(`*Status:* ${detail.status}\n*Fulfillment:* ${detail.fulfillmentStatus}\n*Approval:* ${detail.approvalStatus || 'N/A'}\n*Date:* ${detail.orderDate}`),
    buildDivider(),
    buildSection(`*Financials*\nSubtotal: Rs ${detail.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\nScheme Discount: Rs ${detail.schemeDiscount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\nCredit Applied: Rs ${(detail.creditApplied || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}\nGrand Total: Rs ${detail.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`),
    buildDivider(),
    buildSection(`*Products (${detail.items.length})*`),
    ...detail.items.map((li) => buildSection(`*${li.productName}*\nOrdered: ${li.quantity} | Fulfilled: ${li.fulfilledQuantity} | Expected: ${li.expectedQuantity}\nDelivery: ${li.deliveryStatus} | Unit: ${li.unitOfMeasure}`)),
    buildDivider(),
  ];
  if (detail.grnIds.length > 0) blocks.push(buildSection(`:package: *GRNs:* ${detail.grnIds.join(', ')}`));
  if (detail.returnOrderIds.length > 0) blocks.push(buildSection(`:leftwards_arrow_with_hook: *Return Orders:* ${detail.returnOrderIds.join(', ')}`));
  if (detail.invoiceIds.length > 0) blocks.push(buildSection(`:receipt: *Invoices:* ${detail.invoiceIds.join(', ')}`));
  if ((detail.creditNoteUsageIds || []).length > 0) blocks.push(buildSection(`:money_with_wings: *Credit Note Usages:* ${(detail.creditNoteUsageIds || []).join(', ')}`));
  const actions: any[] = [];
  if (!detail.grnIds.length) actions.push(buildButton(':package: Process GRN', 'process_grn_' + detail.orderId, detail.orderId, 'primary'));
  if (detail.returnOrderIds.length) actions.push(buildButton(':leftwards_arrow_with_hook: View Returns', 'view_ro_from_po_' + detail.orderId, detail.orderId));
  if (actions.length > 0) { blocks.push({ type: 'divider' }); blocks.push({ type: 'actions', elements: actions }); }
  blocks.push({ type: 'actions', elements: [
    buildButton(':clipboard: Back to Orders', SLACK_ACTION_IDS.VIEW_ORDER_DETAIL, 'orders'),
    buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary'),
  ] });
  return blocks;
}

export function buildGRNModal(orderDetail: PrimaryOrderDetail): Block[] {
  const blocks: Block[] = [buildHeader(':package: Process GRN for ' + orderDetail.orderNumber)];
  blocks.push(buildSection('Enter quantities received for each product:'));
  orderDetail.items.forEach((li) => {
    blocks.push(buildSection(`*${li.productName}* (Expected: ${li.expectedQuantity})`));
    blocks.push({
      type: 'input', block_id: `grn_recv_${li.productId}`,
      label: { type: 'plain_text', text: `Received Qty for ${li.productName}`, emoji: true },
      element: { type: 'plain_text_input', action_id: `grn_input_recv_${li.productId}`, initial_value: String(li.expectedQuantity) },
    });
    blocks.push({
      type: 'input', block_id: `grn_dmg_${li.productId}`,
      label: { type: 'plain_text', text: 'Damaged Qty', emoji: true },
      element: { type: 'plain_text_input', action_id: `grn_input_dmg_${li.productId}`, initial_value: '0' }, optional: true,
    });
    blocks.push({
      type: 'input', block_id: `grn_miss_${li.productId}`,
      label: { type: 'plain_text', text: 'Missing Qty', emoji: true },
      element: { type: 'plain_text_input', action_id: `grn_input_miss_${li.productId}`, initial_value: '0' }, optional: true,
    });
  });
  blocks.push({
    type: 'input', block_id: 'grn_notes',
    label: { type: 'plain_text', text: 'Notes', emoji: true },
      element: { type: 'plain_text_input', action_id: 'grn_input_notes', placeholder: { type: 'plain_text', text: 'Any additional notes...', emoji: true } }, optional: true,
  });
  blocks.push({ type: 'actions', elements: [
    buildButton(':white_check_mark: Submit GRN', 'submit_grn_form', orderDetail.orderId, 'primary'),
    buildButton(':clipboard: Back to Order', `view_po_detail_${orderDetail.orderId}`, orderDetail.orderId),
    buildButton(':arrow_left: Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back'),
  ] });
  return blocks;
}

export function buildGRNConfirmation(grn: GRNResult): Block[] {
  const blocks: Block[] = [
    buildHeader(':white_check_mark: GRN Processed'),
    buildSection(`*GRN Number:* ${grn.grnNumber}\n*Status:* ${grn.status}\n*Order:* ${grn.orderId}`),
    buildDivider(),
    buildSection('*Received Quantities:*'),
    ...grn.items.map((i) => buildSection(`Product ${i.productId.slice(-4)}: Received ${i.receivedQuantity} | Damaged ${i.damagedQuantity} | Missing ${i.missingQuantity}`)),
  ];
  if (grn.createdReturnOrderId) {
    blocks.push(buildDivider());
    blocks.push(buildSection(`:warning: *Return Order Created:* ${grn.createdReturnOrderId}\nDamaged/missing quantities have generated a return order.`));
  }
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });
  return blocks;
}

export function buildReturnOrderListBlocks(returns: ReturnOrder[]): Block[] {
  if (returns.length === 0) return [buildHeader(':leftwards_arrow_with_hook: Returns & Claims'), buildSection('No return orders found.'), { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] }];
  const blocks: Block[] = [buildHeader(':leftwards_arrow_with_hook: Returns & Claims'), buildDivider()];
  returns.slice(0, 10).forEach((r) => {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${r.returnNumber}*\nStatus: ${r.status} | Total: Rs ${r.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\nType: ${r.type || 'N/A'} | ${r.description || ''}` },
      accessory: { type: 'button', text: { type: 'plain_text', text: 'View Details', emoji: true }, action_id: `view_ro_detail_${r.returnId}`, value: r.returnId },
    });
    blocks.push(buildDivider());
  });
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });
  return blocks;
}

export function buildReturnOrderDetailBlocks(detail: ReturnOrderDetail, claims: Claim[], approval: ApprovalStatus | null, creditNotes: CreditNote[]): Block[] {
  const blocks: Block[] = [
    buildHeader(`:leftwards_arrow_with_hook: Return ${detail.returnNumber}`),
    buildSection(`*Status:* ${detail.status}\n*Type:* ${detail.type || 'N/A'}\n*Amount:* Rs ${detail.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n*Description:* ${detail.description || 'N/A'}`),
    buildDivider(),
  ];
  if (approval) {
    blocks.push(buildSection(`*Approval:* ${approval.status}\n${approval.approverName ? `Approver: ${approval.approverName}` : ''}${approval.approvedDate ? `\nApproved: ${new Date(approval.approvedDate).toLocaleDateString()}` : ''}`));
    if (approval.isPending) blocks.push({ type: 'actions', elements: [buildButton(':envelope: Submit for Approval', 'submit_approval_' + detail.returnId, detail.returnId, 'primary')] });
    blocks.push(buildDivider());
  }
  if (claims.length > 0) {
    blocks.push(buildSection('*Claims:*'));
    claims.forEach((c) => blocks.push(buildSection(`:memo: *${c.claimNumber}* \u2014 ${c.claimType} \u2014 Status: ${c.status} \u2014 Rs ${c.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`)));
    blocks.push(buildDivider());
    blocks.push({ type: 'actions', elements: [buildButton(':memo: File New Claim', 'file_claim_' + detail.returnId, detail.returnId)] });
  } else {
    blocks.push({ type: 'actions', elements: [buildButton(':memo: File Claim', 'file_claim_' + detail.returnId, detail.returnId, 'primary')] });
  }
  if (creditNotes.length > 0) {
    blocks.push(buildDivider());
    blocks.push(buildSection('*Credit Notes:*'));
    creditNotes.forEach((cn) => blocks.push(buildSection(`:dollar: *${cn.creditNoteNumber}* \u2014 Rs ${cn.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} \u2014 ${cn.status}`)));
  }
  blocks.push({ type: 'actions', elements: [
    buildButton(':leftwards_arrow_with_hook: Back to Returns', 'returns_claims_menu', 'returns'),
    buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary'),
  ] });
  return blocks;
}

export function buildClaimModal(returnOrderId: string): Block[] {
  return [
    buildHeader(':memo: File a Claim'),
    {
      type: 'input', block_id: 'claim_type',
      label: { type: 'plain_text', text: 'Claim Type', emoji: true },
      element: { type: 'static_select', action_id: 'claim_input_type', placeholder: { type: 'plain_text', text: 'Select claim type', emoji: true }, options: [
        { text: { type: 'plain_text', text: 'Damaged Goods', emoji: true }, value: 'Damaged Goods' },
        { text: { type: 'plain_text', text: 'Missing Quantity', emoji: true }, value: 'Missing Quantity' },
        { text: { type: 'plain_text', text: 'Quality Issue', emoji: true }, value: 'Quality Issue' },
        { text: { type: 'plain_text', text: 'Pricing Dispute', emoji: true }, value: 'Pricing Dispute' },
        { text: { type: 'plain_text', text: 'Other', emoji: true }, value: 'Other' },
      ]},
    },
    {
      type: 'input', block_id: 'claim_amount',
      label: { type: 'plain_text', text: 'Claim Amount (Rs)', emoji: true },
      element: { type: 'plain_text_input', action_id: 'claim_input_amount', placeholder: { type: 'plain_text', text: 'e.g. 1500.00', emoji: true } },
    },
    {
      type: 'input', block_id: 'claim_desc',
      label: { type: 'plain_text', text: 'Description', emoji: true },
      element: { type: 'plain_text_input', action_id: 'claim_input_desc', multiline: true, placeholder: { type: 'plain_text', text: 'Describe the issue...', emoji: true } },
    },
    buildDivider(),
    { type: 'actions', elements: [
      buildButton(':white_check_mark: Submit Claim', 'submit_claim_' + returnOrderId, returnOrderId, 'primary'),
      buildButton(':leftwards_arrow_with_hook: Back to Return', `view_ro_detail_${returnOrderId}`, returnOrderId),
      buildButton(':arrow_left: Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back'),
    ] },
  ];
}

export function buildClaimConfirmation(claim: Claim): Block[] {
  return [
    buildHeader(':white_check_mark: Claim Submitted'),
    buildSection(`*Claim Number:* ${claim.claimNumber}\n*Type:* ${claim.claimType}\n*Status:* ${claim.status}\n*Amount:* Rs ${claim.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`),
    buildContext(['Your claim has been submitted. Track status from Returns & Claims.']),
    { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] },
  ];
}

export function buildApprovalResult(result: ApprovalResult): Block[] {
  if (result.success) {
    return [buildHeader(':white_check_mark: Submitted for Approval'), buildSection(result.message)];
  }
  return [buildHeader(':x: Approval Not Available'), buildSection('Approval submission is not available through existing Salesforce APIs. Please submit approval from the Salesforce UI.')];
}
