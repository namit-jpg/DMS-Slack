import { ISalesforceClient, InventoryBatch, ResolvedDistributorContext } from '../salesforce/types';
import { buildInventoryBatchByDistributorQuery } from '../salesforce/queryBuilders';
import { SALESFORCE_CUSTOM_OBJECTS, SALESFORCE_FIELD_MAP } from '../config/salesforceObjectMap';
import { createChildLogger } from '../utils/logger';
import { Result, success, failure } from '../utils/result';
import { BlockedBySalesforceCapabilityError } from '../utils/errors';
import {
  checkIdempotency,
  markProcessing,
  markCompleted,
  markFailed,
} from '../persistence/idempotencyStore';

const logger = createChildLogger('GrnService');

export class GrnService {
  constructor(private sfClient: ISalesforceClient) {}

  async getInventoryBatches(
    account: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<Result<InventoryBatch[], Error>> {
    try {
      const result = await this.sfClient.query<{
        Id: string;
        Product__c: string;
        Distributor__c: string;
        Expiry_Date__c: string;
        Manufacture_Date__c: string;
        Status__c: string;
      }>(
        buildInventoryBatchByDistributorQuery(account.salesforceAccountId),
        correlationId,
      );

      const batches: InventoryBatch[] = result.records.map((r) => ({
        batchId: r.Id,
        productId: r.Product__c,
        distributorId: r.Distributor__c,
        expiryDate: r.Expiry_Date__c,
        manufactureDate: r.Manufacture_Date__c,
        status: r.Status__c,
      }));

      return success(batches);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch inventory batches');
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async createGrn(
    account: ResolvedDistributorContext,
    _grnData: {
      amount?: number;
      notes?: string;
      items?: Array<{ productId: string; quantity: number }>;
    },
    idempotencyKey: string,
    correlationId?: string,
  ): Promise<Result<{ grnId: string; grnNumber: string }, Error>> {
    const existing = checkIdempotency(idempotencyKey);
    if (existing === 'completed') {
      return success({ grnId: 'mock-grn-completed', grnNumber: 'GRN-MOCK' });
    }
    if (existing === 'processing') {
      return failure(new Error('GRN creation is already in progress.'));
    }

    markProcessing(idempotencyKey);

    try {
      // GRN headers are `Goods_Receipt__c` records. In the real RCG process these are
      // auto-created by Salesforce flows on delivery; this manual path is retained only
      // for completeness and is not wired into any live Slack handler.
      const GRN_MAP = SALESFORCE_FIELD_MAP.GOODS_RECEIPT;
      const recordData: Record<string, unknown> = {
        [GRN_MAP.DISTRIBUTOR]: account.salesforceAccountId,
        [GRN_MAP.STATUS]: 'New',
      };

      const grnId = await this.sfClient.create(
        SALESFORCE_CUSTOM_OBJECTS.GOODS_RECEIPT,
        recordData,
        correlationId,
      );

      const result = {
        grnId,
        grnNumber: `GRN-${Date.now().toString().slice(-6)}`,
      };

      markCompleted(idempotencyKey, result);
      return success(result);
    } catch (err) {
      logger.error({ err }, 'Failed to create GRN');
      markFailed(idempotencyKey);
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
