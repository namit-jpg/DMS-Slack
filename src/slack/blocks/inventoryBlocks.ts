import { InventoryBatch } from '../../salesforce/types';
import { buildSection, buildDivider, buildHeader, buildContext } from './commonBlocks';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = any;

export function buildInventoryBlocks(batches: InventoryBatch[]): Block[] {
  const blocks: Block[] = [buildHeader(':package: Inventory Status'), buildDivider()];

  const groupedByProduct: Record<string, InventoryBatch[]> = {};
  for (const b of batches) {
    if (!groupedByProduct[b.productId]) {
      groupedByProduct[b.productId] = [];
    }
    groupedByProduct[b.productId].push(b);
  }

  for (const [productId, batchList] of Object.entries(groupedByProduct)) {
    const totalStock = batchList.length;
    const expiringSoon = batchList.filter(
      (b) =>
        b.expiryDate &&
        new Date(b.expiryDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ).length;

    blocks.push(
      buildSection(
        `*${productId.slice(0, 8)}...* | Stock: *${totalStock}* units | ` +
          `Status: ${batchList[0].status}${expiringSoon > 0 ? `\n:warning: ${expiringSoon} batches expiring soon` : ''}`,
      ),
    );
    blocks.push(buildDivider());
  }

  blocks.push(buildContext([`Last updated: ${new Date().toLocaleString()}`]));

  return blocks;
}
