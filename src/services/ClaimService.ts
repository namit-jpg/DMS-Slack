import { ISalesforceClient, Claim, ResolvedDistributorContext } from '../salesforce/types';
import { buildClaimsByAccountQuery } from '../salesforce/queryBuilders';
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

const logger = createChildLogger('ClaimService');

export class ClaimService {
  constructor(private sfClient: ISalesforceClient) {}

  async getClaimsByAccount(
    account: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<Result<Claim[], Error>> {
    try {
      const result = await this.sfClient.query<{
        Id: string;
        Name: string;
        Account__c: string;
        Claim_Type__c: string;
        Status__c: string;
        Amount__c: number;
        Total_Amount__c: number;
        Notes__c: string;
        Claim_Number__c: string;
      }>(
        buildClaimsByAccountQuery(account.salesforceAccountId),
        correlationId,
      );

      const claims: Claim[] = result.records.map((r) => ({
        claimId: r.Id,
        claimNumber: r.Claim_Number__c || r.Name,
        accountId: r.Account__c,
        claimType: r.Claim_Type__c,
        status: r.Status__c,
        amount: r.Amount__c || 0,
        totalAmount: r.Total_Amount__c || 0,
        notes: r.Notes__c,
      }));

      return success(claims);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch claims');
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async createClaim(
    account: ResolvedDistributorContext,
    claimData: {
      claimType: string;
      amount?: number;
      notes?: string;
      orderId?: string;
      returnOrderId?: string;
      productId?: string;
    },
    idempotencyKey: string,
    correlationId?: string,
  ): Promise<Result<Claim, Error>> {
    const existing = checkIdempotency(idempotencyKey);
    if (existing === 'completed') {
      return success(this.buildMockClaim(account, claimData));
    }
    if (existing === 'processing') {
      return failure(new Error('Claim creation is already in progress.'));
    }

    markProcessing(idempotencyKey);

    try {
      const C = SALESFORCE_FIELD_MAP.CLAIM_CUSTOM;
      const recordData: Record<string, unknown> = {
        [C.ACCOUNT]: account.salesforceAccountId,
        [C.CLAIM_TYPE]: claimData.claimType,
        [C.STATUS]: 'Open',
        [C.AMOUNT]: claimData.amount || 0,
        [C.NOTES]: claimData.notes || '',
        [C.TYPE]: claimData.claimType,
      };

      if (claimData.orderId) recordData[C.ORDER] = claimData.orderId;
      if (claimData.returnOrderId) recordData[C.RETURN_ORDER] = claimData.returnOrderId;
      if (claimData.productId) recordData[C.PRODUCT] = claimData.productId;

      if (this.sfClient.isMock()) {
        const mock = this.buildMockClaim(account, claimData);
        markCompleted(idempotencyKey, mock);
        return success(mock);
      }

      const claimId = await this.sfClient.create(
        SALESFORCE_CUSTOM_OBJECTS.CLAIM_CUSTOM,
        recordData,
        correlationId,
      );

      const claim: Claim = {
        claimId,
        claimNumber: `CLM-${Date.now().toString().slice(-6)}`,
        accountId: account.salesforceAccountId,
        claimType: claimData.claimType,
        status: 'Open',
        amount: claimData.amount || 0,
        totalAmount: claimData.amount || 0,
        notes: claimData.notes,
      };

      markCompleted(idempotencyKey, claim);
      return success(claim);
    } catch (err) {
      logger.error({ err }, 'Failed to create claim');
      markFailed(idempotencyKey);
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private buildMockClaim(
    account: ResolvedDistributorContext,
    claimData: { claimType: string; amount?: number; notes?: string },
  ): Claim {
    return {
      claimId: 'mock-claim-' + Date.now(),
      claimNumber: 'CLM-MOCK-' + Date.now().toString().slice(-4),
      accountId: account.salesforceAccountId,
      claimType: claimData.claimType,
      status: 'Open',
      amount: claimData.amount || 0,
      totalAmount: claimData.amount || 0,
      notes: claimData.notes || '',
    };
  }
}
