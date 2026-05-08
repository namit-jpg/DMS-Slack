import { ReturnOrder } from '../../salesforce/types';
import { buildSection, buildDivider, buildHeader } from './commonBlocks';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = any;

export function buildReturnOrderListBlocks(returns: ReturnOrder[]): Block[] {
  if (returns.length === 0) {
    return [
      buildHeader(':leftwards_arrow_with_hook: Returns & Claims'),
      buildSection('No return orders found for your account.'),
    ];
  }

  const blocks: Block[] = [
    buildHeader(':leftwards_arrow_with_hook: Returns & Claims'),
    buildDivider(),
  ];

  for (const ret of returns.slice(0, 10)) {
    blocks.push(
      buildSection(
        `*${ret.returnNumber}*\n` +
          `Status: *${ret.status}* | Grand Total: Rs ${ret.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}\n` +
          `Type: ${ret.type || 'N/A'} | Final: Rs ${(ret.finalAmount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      ),
    );
    blocks.push(buildDivider());
  }

  return blocks;
}
