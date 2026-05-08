import { ISalesforceClient, ResolvedDistributorContext } from '../salesforce/types';
import { createChildLogger } from '../utils/logger';
import { Result, success, failure } from '../utils/result';

const logger = createChildLogger('SecondaryOrderService');

export class SecondaryOrderService {
  constructor(private sfClient: ISalesforceClient) {}

  async createSecondaryOrder(
    account: ResolvedDistributorContext,
    secondaryOrderData: {
      primaryOrderIds: string[];
      retailerId?: string;
      notes?: string;
    },
    correlationId?: string,
  ): Promise<Result<{ secondaryOrderId: string; status: string }, Error>> {
    logger.info(
      { accountId: account.salesforceAccountId, primaryOrderCount: secondaryOrderData.primaryOrderIds.length },
      'Secondary order creation requested',
    );

    if (this.sfClient.isMock()) {
      return success({
        secondaryOrderId: 'mock-secondary-' + Date.now(),
        status: 'Created',
      });
    }

    logger.warn('Secondary order creation: SecondaryOrderBulkInvoiceController endpoint not available');
    return failure(
      new Error(
        'Secondary order creation requires the SecondaryOrderBulkInvoiceController REST endpoint ' +
        'which is not yet documented. This is blocked by BLK-004.',
      ),
    );
  }

  async getSecondaryOrders(
    account: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<Result<Array<{ orderId: string; status: string; totalAmount: number }>, Error>> {
    if (this.sfClient.isMock()) {
      return success([
        {
          orderId: 'mock-secondary-001',
          status: 'Completed',
          totalAmount: 4500.00,
        },
        {
          orderId: 'mock-secondary-002',
          status: 'Pending',
          totalAmount: 3200.00,
        },
      ]);
    }

    return failure(
      new Error(
        'Secondary order listing requires documented REST endpoints. This is blocked by BLK-004.',
      ),
    );
  }
}
