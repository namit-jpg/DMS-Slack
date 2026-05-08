import { ISalesforceClient, ReturnOrder, ResolvedDistributorContext } from '../salesforce/types';
import { buildReturnOrdersByAccountQuery } from '../salesforce/queryBuilders';
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

const logger = createChildLogger('ReturnOrderService');

export class ReturnOrderService {
  constructor(private sfClient: ISalesforceClient) {}

  async getReturnsByAccount(
    account: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<Result<ReturnOrder[], Error>> {
    try {
      const result = await this.sfClient.query<{
        Id: string;
        Name: string;
        Account__c: string;
        Status__c: string;
        Grand_Total__c: number;
        Reverse_Scheme_Amount__c: number;
        Final_Amount__c: number;
        Description__c: string;
        Type__c: string;
      }>(
        buildReturnOrdersByAccountQuery(account.salesforceAccountId),
        correlationId,
      );

      const returns: ReturnOrder[] = result.records.map((r) => ({
        returnId: r.Id,
        returnNumber: r.Name,
        accountId: r.Account__c,
        status: r.Status__c,
        grandTotal: r.Grand_Total__c || 0,
        reverseSchemeAmount: r.Reverse_Scheme_Amount__c,
        finalAmount: r.Final_Amount__c,
        description: r.Description__c,
        type: r.Type__c,
        items: [],
      }));

      return success(returns);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch return orders');
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async createReturnOrder(
    account: ResolvedDistributorContext,
    returnData: {
      orderId?: string;
      description?: string;
      reason?: string;
      items?: Array<{ productId: string; quantity: number; goodQuantity?: number; defectiveQuantity?: number }>;
    },
    idempotencyKey: string,
    correlationId?: string,
  ): Promise<Result<ReturnOrder, Error>> {
    const existing = checkIdempotency(idempotencyKey);
    if (existing === 'completed') {
      return success(this.buildMockReturn(account, returnData));
    }
    if (existing === 'processing') {
      return failure(new Error('Return order creation is already in progress.'));
    }

    markProcessing(idempotencyKey);

    try {
      const RO = SALESFORCE_FIELD_MAP.RETURN_ORDER_CUSTOM;
      const recordData: Record<string, unknown> = {
        [RO.ACCOUNT]: account.salesforceAccountId,
        [RO.STATUS]: 'Draft',
        [RO.DESCRIPTION]: returnData.description || '',
        [RO.TYPE]: returnData.reason || 'Standard Return',
      };

      if (returnData.orderId) {
        recordData[RO.ORDER] = returnData.orderId;
      }

      if (this.sfClient.isMock()) {
        const mock = this.buildMockReturn(account, returnData);
        markCompleted(idempotencyKey, mock);
        return success(mock);
      }

      const returnOrderId = await this.sfClient.create(
        SALESFORCE_CUSTOM_OBJECTS.RETURN_ORDER_CUSTOM,
        recordData,
        correlationId,
      );

      const returnOrder: ReturnOrder = {
        returnId: returnOrderId,
        returnNumber: `RO-${Date.now().toString().slice(-6)}`,
        accountId: account.salesforceAccountId,
        orderId: returnData.orderId,
        status: 'Draft',
        grandTotal: 0,
        description: returnData.description,
        type: returnData.reason,
        items: [],
      };

      markCompleted(idempotencyKey, returnOrder);
      return success(returnOrder);
    } catch (err) {
      logger.error({ err }, 'Failed to create return order');
      markFailed(idempotencyKey);
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private buildMockReturn(
    account: ResolvedDistributorContext,
    returnData: {
      orderId?: string;
      description?: string;
      items?: Array<{ productId: string; quantity: number }>;
    },
  ): ReturnOrder {
    return {
      returnId: 'mock-return-' + Date.now(),
      returnNumber: 'RO-MOCK-' + Date.now().toString().slice(-4),
      accountId: account.salesforceAccountId,
      orderId: returnData.orderId,
      status: 'Draft',
      grandTotal: 0,
      description: returnData.description,
      type: 'Mock Return',
      reverseSchemeAmount: 0,
      finalAmount: 0,
      items: [],
    };
  }
}
