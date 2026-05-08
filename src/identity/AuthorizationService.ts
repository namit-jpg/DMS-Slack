import {
  ResolvedDistributorContext,
  ISalesforceClient,
} from '../salesforce/types';
import { SALESFORCE_CUSTOM_OBJECTS, SALESFORCE_FIELD_MAP, SALESFORCE_OBJECTS } from '../config/salesforceObjectMap';
import { createChildLogger } from '../utils/logger';
import {
  AuthorizationError,
  RecordAccessForbiddenError,
  IdentityResolutionError,
} from '../utils/errors';
import { isValidSalesforceId } from '../utils/validation';

const logger = createChildLogger('AuthorizationService');

export class AuthorizationService {
  private sfClient: ISalesforceClient;

  constructor(sfClient: ISalesforceClient) {
    this.sfClient = sfClient;
  }

  verifyContextExists(
    context: ResolvedDistributorContext | null,
    slackUserId: string,
  ): ResolvedDistributorContext {
    if (!context) {
      logger.warn({ slackUserId }, 'No distributor context resolved');
      throw new AuthorizationError(
        'Your Slack email is not mapped to a Distributor Account in Salesforce. Please contact your admin.',
      );
    }

    if (!context.isActive) {
      logger.warn(
        { slackUserId, accountId: context.salesforceAccountId },
        'Distributor account is inactive',
      );
      throw IdentityResolutionError.inactiveAccount(
        context.slackEmail,
        context.salesforceAccountId,
      );
    }

    return context;
  }

  async assertCanAccessPrimaryOrder(
    context: ResolvedDistributorContext,
    orderId: string,
  ): Promise<void> {
    if (!isValidSalesforceId(orderId)) {
      throw new RecordAccessForbiddenError('Order', orderId);
    }

    const escapedOrderId = orderId.replace(/'/g, "\\'");
    const escapedAccountId = context.salesforceAccountId.replace(/'/g, "\\'");

    const soql = `SELECT Id FROM ${SALESFORCE_OBJECTS.ORDER} WHERE Id = '${escapedOrderId}' AND AccountId = '${escapedAccountId}' LIMIT 1`;

    try {
      const result = await this.sfClient.query(soql);
      if (result.records.length === 0) {
        logger.warn(
          {
            slackUserId: context.slackUserId,
            orderId,
            accountId: context.salesforceAccountId,
          },
          'Cross-account primary order access blocked',
        );
        throw new RecordAccessForbiddenError('Order', orderId);
      }
    } catch (err) {
      if (err instanceof RecordAccessForbiddenError) throw err;
      logger.error({ err, orderId }, 'Error checking order ownership');
      throw new RecordAccessForbiddenError('Order', orderId);
    }
  }

  async assertCanAccessReturnOrder(
    context: ResolvedDistributorContext,
    returnOrderId: string,
  ): Promise<void> {
    if (!isValidSalesforceId(returnOrderId)) {
      throw new RecordAccessForbiddenError('ReturnOrder', returnOrderId);
    }

    const RO = SALESFORCE_FIELD_MAP.RETURN_ORDER_CUSTOM;
    const escapedId = returnOrderId.replace(/'/g, "\\'");
    const escapedAccountId = context.salesforceAccountId.replace(/'/g, "\\'");

    const soql = `SELECT Id FROM ${SALESFORCE_CUSTOM_OBJECTS.RETURN_ORDER_CUSTOM} WHERE Id = '${escapedId}' AND ${RO.ACCOUNT} = '${escapedAccountId}' LIMIT 1`;

    try {
      const result = await this.sfClient.query(soql);
      if (result.records.length === 0) {
        logger.warn(
          {
            slackUserId: context.slackUserId,
            returnOrderId,
            accountId: context.salesforceAccountId,
          },
          'Cross-account return order access blocked',
        );
        throw new RecordAccessForbiddenError('ReturnOrder', returnOrderId);
      }
    } catch (err) {
      if (err instanceof RecordAccessForbiddenError) throw err;
      logger.error({ err, returnOrderId }, 'Error checking return order ownership');
      throw new RecordAccessForbiddenError('ReturnOrder', returnOrderId);
    }
  }

  async assertCanAccessClaim(
    context: ResolvedDistributorContext,
    claimId: string,
  ): Promise<void> {
    if (!isValidSalesforceId(claimId)) {
      throw new RecordAccessForbiddenError('Claim', claimId);
    }

    const C = SALESFORCE_FIELD_MAP.CLAIM_CUSTOM;
    const escapedId = claimId.replace(/'/g, "\\'");
    const escapedAccountId = context.salesforceAccountId.replace(/'/g, "\\'");

    const soql = `SELECT Id FROM ${SALESFORCE_CUSTOM_OBJECTS.CLAIM_CUSTOM} WHERE Id = '${escapedId}' AND ${C.ACCOUNT} = '${escapedAccountId}' LIMIT 1`;

    try {
      const result = await this.sfClient.query(soql);
      if (result.records.length === 0) {
        logger.warn(
          {
            slackUserId: context.slackUserId,
            claimId,
            accountId: context.salesforceAccountId,
          },
          'Cross-account claim access blocked',
        );
        throw new RecordAccessForbiddenError('Claim', claimId);
      }
    } catch (err) {
      if (err instanceof RecordAccessForbiddenError) throw err;
      logger.error({ err, claimId }, 'Error checking claim ownership');
      throw new RecordAccessForbiddenError('Claim', claimId);
    }
  }

  async assertCanAccessInvoice(
    context: ResolvedDistributorContext,
    invoiceId: string,
  ): Promise<void> {
    if (!isValidSalesforceId(invoiceId)) {
      throw new RecordAccessForbiddenError('Invoice', invoiceId);
    }

    const I = SALESFORCE_FIELD_MAP.INVOICE_CUSTOM;
    const escapedId = invoiceId.replace(/'/g, "\\'");
    const escapedAccountId = context.salesforceAccountId.replace(/'/g, "\\'");

    const soql = `SELECT Id FROM ${SALESFORCE_CUSTOM_OBJECTS.INVOICE_CUSTOM} WHERE Id = '${escapedId}' AND ${I.BILLING_ACCOUNT} = '${escapedAccountId}' LIMIT 1`;

    try {
      const result = await this.sfClient.query(soql);
      if (result.records.length === 0) {
        logger.warn(
          {
            slackUserId: context.slackUserId,
            invoiceId,
            accountId: context.salesforceAccountId,
          },
          'Cross-account invoice access blocked',
        );
        throw new RecordAccessForbiddenError('Invoice', invoiceId);
      }
    } catch (err) {
      if (err instanceof RecordAccessForbiddenError) throw err;
      logger.error({ err, invoiceId }, 'Error checking invoice ownership');
      throw new RecordAccessForbiddenError('Invoice', invoiceId);
    }
  }

  async assertCanAccessDispatchRequest(
    context: ResolvedDistributorContext,
    dispatchId: string,
  ): Promise<void> {
    if (!isValidSalesforceId(dispatchId)) {
      throw new RecordAccessForbiddenError('DispatchRequest', dispatchId);
    }

    const D = SALESFORCE_FIELD_MAP.DISPATCH_REQUEST;
    const escapedId = dispatchId.replace(/'/g, "\\'");
    const escapedAccountId = context.salesforceAccountId.replace(/'/g, "\\'");

    const soql = `
      SELECT Id FROM ${SALESFORCE_CUSTOM_OBJECTS.DISPATCH_REQUEST}
      WHERE Id = '${escapedId}'
      AND ${D.ORDER} IN (
        SELECT Id FROM ${SALESFORCE_OBJECTS.ORDER}
        WHERE AccountId = '${escapedAccountId}'
      )
      LIMIT 1
    `.replace(/\n/g, ' ').trim();

    try {
      const result = await this.sfClient.query(soql);
      if (result.records.length === 0) {
        logger.warn(
          {
            slackUserId: context.slackUserId,
            dispatchId,
            accountId: context.salesforceAccountId,
          },
          'Cross-account dispatch request access blocked',
        );
        throw new RecordAccessForbiddenError('DispatchRequest', dispatchId);
      }
    } catch (err) {
      if (err instanceof RecordAccessForbiddenError) throw err;
      logger.error({ err, dispatchId }, 'Error checking dispatch ownership');
      throw new RecordAccessForbiddenError('DispatchRequest', dispatchId);
    }
  }

  async assertCanAccessSecondaryOrder(
    context: ResolvedDistributorContext,
    secondaryOrderId: string,
  ): Promise<void> {
    if (!isValidSalesforceId(secondaryOrderId)) {
      throw new RecordAccessForbiddenError('SecondaryOrder', secondaryOrderId);
    }

    const soql = `
      SELECT Id FROM Invoice__c
      WHERE Id = '${secondaryOrderId.replace(/'/g, "\\'")}'
      AND Type__c = 'Secondary'
      AND Billing_Account__c = '${context.salesforceAccountId.replace(/'/g, "\\'")}'
      LIMIT 1
    `.replace(/\n/g, ' ').trim();

    try {
      const result = await this.sfClient.query(soql);
      if (result.records.length === 0) {
        logger.warn(
          {
            slackUserId: context.slackUserId,
            secondaryOrderId,
            accountId: context.salesforceAccountId,
          },
          'Cross-account secondary order access blocked',
        );
        throw new RecordAccessForbiddenError('SecondaryOrder', secondaryOrderId);
      }
    } catch (err) {
      if (err instanceof RecordAccessForbiddenError) throw err;
      throw new RecordAccessForbiddenError('SecondaryOrder', secondaryOrderId);
    }
  }
}
