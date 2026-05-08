import { ISalesforceClient, DispatchRequest, ResolvedDistributorContext } from '../salesforce/types';
import { buildDispatchByDistributorQuery } from '../salesforce/queryBuilders';
import { createChildLogger } from '../utils/logger';
import { Result, success, failure } from '../utils/result';

const logger = createChildLogger('DispatchService');

export class DispatchService {
  constructor(private sfClient: ISalesforceClient) {}

  async getDispatchesByDistributor(
    account: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<Result<DispatchRequest[], Error>> {
    try {
      const result = await this.sfClient.query<{
        Id: string;
        Dispatch_Request_Name__c: string;
        Order__c: string;
        Status__c: string;
        Start_Date__c: string;
        End_Date__c: string;
        Source_Address__c: string;
        Destination_Address__c: string;
      }>(
        buildDispatchByDistributorQuery(account.salesforceAccountId),
        correlationId,
      );

      const dispatches: DispatchRequest[] = result.records.map((r) => ({
        dispatchId: r.Id,
        dispatchName: r.Dispatch_Request_Name__c || r.Id,
        orderId: r.Order__c,
        status: r.Status__c,
        startDate: r.Start_Date__c,
        endDate: r.End_Date__c,
        sourceAddress: r.Source_Address__c,
        destinationAddress: r.Destination_Address__c,
      }));

      return success(dispatches);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch dispatches');
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async getDispatchDetail(
    dispatchId: string,
    correlationId?: string,
  ): Promise<Result<DispatchRequest, Error>> {
    try {
      const record = await this.sfClient.getRecord<{
        Id: string;
        Dispatch_Request_Name__c: string;
        Order__c: string;
        Status__c: string;
        Invoice_Custom__c: string;
        Start_Date__c: string;
        End_Date__c: string;
        Source_Address__c: string;
        Destination_Address__c: string;
      }>('Dispatch_Request__c', dispatchId, undefined, correlationId);

      return success({
        dispatchId: record.Id,
        dispatchName: record.Dispatch_Request_Name__c || record.Id,
        orderId: record.Order__c,
        status: record.Status__c,
        invoiceId: record.Invoice_Custom__c,
        startDate: record.Start_Date__c,
        endDate: record.End_Date__c,
        sourceAddress: record.Source_Address__c,
        destinationAddress: record.Destination_Address__c,
      });
    } catch (err) {
      logger.error({ err, dispatchId }, 'Failed to fetch dispatch detail');
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
