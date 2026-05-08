import { ISalesforceClient, ResolvedDistributorContext } from '../salesforce/types';
import {
  buildDistributorQuery,
  buildAccountByEmailQuery,
  buildAccountByIdQuery,
  buildAccountByEmailBulkQuery,
} from '../salesforce/queryBuilders';
import { SALESFORCE_FIELD_MAP } from '../config/salesforceObjectMap';
import { createChildLogger } from '../utils/logger';
import { IdentityResolutionError } from '../utils/errors';
import { Result } from '../utils/result';

const logger = createChildLogger('DistributorResolver');

export class DistributorResolver {
  constructor(private sfClient: ISalesforceClient) {}

  async resolveByEmail(
    slackUserId: string,
    slackTeamId: string,
    slackEnterpriseId: string | null,
    email: string,
    correlationId?: string,
  ): Promise<Result<ResolvedDistributorContext, IdentityResolutionError>> {
    const log = correlationId
      ? createChildLogger('DistributorResolver', correlationId)
      : logger;

    log.info({ email }, 'Resolving distributor account by email');

    try {
      let context = await this.tryContactEmailPath(
        email,
        slackUserId,
        slackTeamId,
        slackEnterpriseId,
        correlationId,
      );
      if (context) return { success: true, data: context as ResolvedDistributorContext };

      context = await this.tryAccountEmailPath(
        email,
        slackUserId,
        slackTeamId,
        slackEnterpriseId,
        correlationId,
      );
      if (context) return { success: true, data: context as ResolvedDistributorContext };

      log.warn({ email }, 'No distributor account found for email');
      return { success: false, error: IdentityResolutionError.notMapped(email) };
    } catch (err) {
      if (err instanceof IdentityResolutionError) {
        return { success: false, error: err };
      }
      log.error({ err, email }, 'Unexpected error resolving distributor account');
      return { success: false, error: new IdentityResolutionError({
          code: 'RESOLUTION_ERROR',
          message: `Unexpected error resolving email ${email}`,
          userMessage:
            'An unexpected error occurred while resolving your account. Please try again.',
          statusCode: 500,
          cause: err instanceof Error ? err : undefined,
        }) };
    }
  }

  private async tryContactEmailPath(
    email: string,
    slackUserId: string,
    slackTeamId: string,
    slackEnterpriseId: string | null,
    correlationId?: string,
  ): Promise<ResolvedDistributorContext | null> {
    const contactResult = await this.sfClient.query<{
      Id: string;
      Email: string;
      FirstName?: string;
      LastName?: string;
      Distributor__c: string;
    }>(buildDistributorQuery(email), correlationId);

    if (contactResult.records.length > 0) {
      const contact = contactResult.records[0];
      if (contact.Distributor__c) {
        const account = await this.sfClient.query<{
          Id: string;
          Name: string;
          Type: string;
          IsPartner: boolean;
          Business_Type__c: string;
          Email__c?: string;
        }>(buildAccountByIdQuery(contact.Distributor__c), correlationId);

        if (account.records.length > 0) {
          const acc = account.records[0];
          logger.info(
            { accountId: acc.Id, mappingSource: 'ContactEmail' },
            'Resolved via Contact.Distributor__c',
          );
          return this.buildContext(
            acc,
            slackUserId,
            slackTeamId,
            slackEnterpriseId,
            email,
            'ContactEmail',
          );
        }
      }
    }
    return null;
  }

  private async tryAccountEmailPath(
    email: string,
    slackUserId: string,
    slackTeamId: string,
    slackEnterpriseId: string | null,
    correlationId?: string,
  ): Promise<ResolvedDistributorContext | null> {
    const accountResult = await this.sfClient.query<{
      Id: string;
      Name: string;
      Type: string;
      IsPartner: boolean;
      Business_Type__c: string;
      Email__c?: string;
    }>(buildAccountByEmailBulkQuery(email), correlationId);

    const records = accountResult.records;

    if (records.length === 0) {
      return null;
    }

    if (records.length > 1) {
      logger.warn(
        {
          email,
          accountCount: records.length,
          accountIds: records.map((r) => r.Id),
        },
        'Duplicate Account mapping detected',
      );
      throw IdentityResolutionError.duplicateMapping(email, records.length);
    }

    const acc = records[0];
    logger.info(
      { accountId: acc.Id, mappingSource: 'AccountEmail' },
      'Resolved via Account.Email__c',
    );
    return this.buildContext(
      acc,
      slackUserId,
      slackTeamId,
      slackEnterpriseId,
      email,
      'AccountEmail',
    );
  }

  private buildContext(
    acc: {
      Id: string;
      Name: string;
      Type: string;
      IsPartner: boolean;
      Business_Type__c: string;
      Email__c?: string;
    },
    slackUserId: string,
    slackTeamId: string,
    slackEnterpriseId: string | null,
    slackEmail: string,
    mappingSource: ResolvedDistributorContext['mappingSource'],
  ): ResolvedDistributorContext | null {
    if (!acc.IsPartner) {
      return null;
    }

    return {
      slackUserId,
      slackTeamId,
      slackEnterpriseId,
      slackEmail,
      salesforceAccountId: acc.Id,
      accountName: acc.Name,
      distributorCode: null,
      mappingSource,
      resolvedAt: new Date().toISOString(),
      isActive: true,
      accountType: acc.Type || 'Unknown',
      businessType: acc.Business_Type__c || 'Distributor',
    };
  }
}
