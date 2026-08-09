import type { ReturnOrder, ReturnOrderDetail, Claim, ApprovalStatus, CreditNote } from '../../salesforce/types';
import { buildSection, buildDivider, buildHeader, buildButton } from './commonBlocks';
import { SLACK_ACTION_IDS } from '../../config/slackConstants';
import { formatDate, formatCurrency } from '../../utils/formatters';

type Block = any;

export function buildReturnOrderListBlocks(returns: ReturnOrder[]): Block[] {
  if (returns.length === 0) {
    return [buildHeader(':leftwards_arrow_with_hook: Returns'), buildSection('No return orders found.'), { type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] }];
  }

  const blocks: Block[] = [buildHeader(':leftwards_arrow_with_hook: Returns'), buildDivider()];
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back')] });
  blocks.push(buildDivider());

  for (const ret of returns.slice(0, 10)) {
    blocks.push(buildSection(
      `*${ret.returnNumber}*\nStatus: *${ret.status}* | Total: Rs ${formatCurrency(ret.grandTotal)} | Type: ${ret.type || 'N/A'}`,
    ));
    blocks.push(buildDivider());
  }
  return blocks;
}

export function buildReturnOrderDetailBlocks(
  detail: ReturnOrderDetail, claims: Claim[], approval: ApprovalStatus | null, creditNotes: CreditNote[],
): Block[] {
  const blocks: Block[] = [
    buildHeader(`:leftwards_arrow_with_hook: Return ${detail.returnNumber}`),
    buildSection(`*Status:* ${detail.status}\n*Type:* ${detail.type || 'N/A'}\n*Amount:* Rs ${formatCurrency(detail.grandTotal)}${detail.description ? '\n*Reason:* ' + detail.description : ''}`),
    buildDivider(),
  ];

  // Top actions
  blocks.push({ type: 'actions', elements: [
    buildButton(':package: Upload File', `upload_return_file_${detail.returnId}`, detail.returnId, 'primary'),
    buildButton(':envelope: Send for Approval', `submit_return_approval_${detail.returnId}`, detail.returnId),
    buildButton(':arrow_left: Back to Returns', 'returns_menu', 'back'),
  ]});
  blocks.push(buildDivider());

  if (approval) {
    blocks.push(buildSection(`*Approval:* ${approval.status}\n${approval.approverName ? 'Approver: ' + approval.approverName : ''}${approval.approvedDate ? '\nDate: ' + formatDate(approval.approvedDate) : ''}`));
    if (approval.isPending) blocks.push({ type: 'actions', elements: [buildButton(':envelope: Submit for Approval', `submit_approval_${detail.returnId}`, detail.returnId, 'primary')] });
    blocks.push(buildDivider());
  }

  if (claims.length > 0) {
    blocks.push(buildSection('*Claims:*'));
    claims.forEach((c) => blocks.push(buildSection(`:memo: *${c.claimNumber}* — ${c.claimType} — ${c.status} — Rs ${formatCurrency(c.amount)}`)));
    blocks.push(buildDivider());
    blocks.push({ type: 'actions', elements: [buildButton(':memo: File New Claim', `file_claim_${detail.returnId}`, detail.returnId)] });
  } else {
    blocks.push({ type: 'actions', elements: [buildButton(':memo: File Claim', `file_claim_${detail.returnId}`, detail.returnId, 'primary')] });
  }
  if (creditNotes.length > 0) {
    blocks.push(buildDivider());
    blocks.push(buildSection('*Credit Notes:*'));
    creditNotes.forEach((cn) => blocks.push(buildSection(`:dollar: *${cn.creditNoteNumber}* — Rs ${formatCurrency(cn.amount)} — ${cn.status}`)));
  }
  return blocks;
}
