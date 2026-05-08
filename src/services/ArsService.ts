import { ISalesforceClient, ArsSettings, ArsProductSetting, ResolvedDistributorContext } from '../salesforce/types';
import { createChildLogger } from '../utils/logger';
import { Result, success, failure } from '../utils/result';
import { BlockedBySalesforceCapabilityError } from '../utils/errors';
import { buildInventoryBatchByDistributorQuery } from '../salesforce/queryBuilders';

const logger = createChildLogger('ArsService');

export class ArsService {
  constructor(private sfClient: ISalesforceClient) {}

  async getArsSettings(
    account: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<Result<ArsSettings, Error>> {
    if (this.sfClient.isMock()) {
      return success({
        autoReplenishmentEnabled: true,
        minThreshold: 10,
        maxThreshold: 50,
        replenishmentFrequency: 'weekly',
        products: [
          {
            productId: '01tMOCK000000001',
            productName: 'Beverage Pack A',
            currentStock: 25,
            minThreshold: 10,
            maxThreshold: 50,
            reorderPoint: 15,
            reorderQuantity: 30,
          },
          {
            productId: '01tMOCK000000002',
            productName: 'Snack Box B',
            currentStock: 5,
            minThreshold: 10,
            maxThreshold: 50,
            reorderPoint: 15,
            reorderQuantity: 40,
          },
        ],
      });
    }

    logger.warn('ARS settings via REST: InventoryReplenishmentController endpoint not available');
    return failure(
      new BlockedBySalesforceCapabilityError(
        'ARS settings retrieval via REST API',
      ),
    );
  }

  async getInventoryStatus(
    account: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<Result<ArsProductSetting[], Error>> {
    try {
      const batches = await this.sfClient.query<{
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

      const productStock: Record<string, number> = {};
      for (const b of batches.records) {
        productStock[b.Product__c] = (productStock[b.Product__c] || 0) + 1;
      }

      const products: ArsProductSetting[] = Object.entries(productStock).map(
        ([productId, stock]) => ({
          productId,
          productName: productId,
          currentStock: stock,
          minThreshold: 10,
          maxThreshold: 50,
          reorderPoint: 15,
          reorderQuantity: 30,
        }),
      );

      return success(products);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch inventory status');
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async updateReplenishmentSettings(
    account: ResolvedDistributorContext,
    settings: Partial<ArsSettings>,
    correlationId?: string,
  ): Promise<Result<ArsSettings, Error>> {
    logger.info(
      { accountId: account.salesforceAccountId },
      'ARS settings update requested',
    );

    if (this.sfClient.isMock()) {
      return success({
        autoReplenishmentEnabled: settings.autoReplenishmentEnabled ?? true,
        minThreshold: settings.minThreshold ?? 10,
        maxThreshold: settings.maxThreshold ?? 50,
        replenishmentFrequency: settings.replenishmentFrequency ?? 'weekly',
        products: [],
      });
    }

    return failure(
      new BlockedBySalesforceCapabilityError(
        'ARS settings update via REST API',
      ),
    );
  }
}
