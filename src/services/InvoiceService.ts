import { ISalesforceClient, DMSInvoice, ResolvedDistributorContext } from '../salesforce/types';
import { buildInvoicesByAccountQuery } from '../salesforce/queryBuilders';
import { createChildLogger } from '../utils/logger';
import { Result, success, failure } from '../utils/result';

const logger = createChildLogger('InvoiceService');

export class InvoiceService {
  constructor(private sfClient: ISalesforceClient) {}

  async getInvoicesByAccount(
    account: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<Result<DMSInvoice[], Error>> {
    try {
      const result = await this.sfClient.query<{
        Id: string;
        Name: string;
        Billing_Account__c: string;
        Status__c: string;
        Total_Amount__c: number;
        Invoice_Date__c: string;
        Due_Date__c: string;
        Payment_Status__c: string;
        Type__c: string;
      }>(
        buildInvoicesByAccountQuery(account.salesforceAccountId),
        correlationId,
      );

      const invoices: DMSInvoice[] = result.records.map((r) => ({
        invoiceId: r.Id,
        invoiceNumber: r.Name,
        accountId: r.Billing_Account__c,
        status: r.Status__c,
        totalAmount: r.Total_Amount__c || 0,
        invoiceDate: r.Invoice_Date__c,
        dueDate: r.Due_Date__c,
        paymentStatus: r.Payment_Status__c,
        type: r.Type__c,
      }));

      return success(invoices);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch invoices');
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async getInvoiceDetail(
    invoiceId: string,
    correlationId?: string,
  ): Promise<Result<DMSInvoice, Error>> {
    try {
      const record = await this.sfClient.getRecord<{
        Id: string;
        Name: string;
        Billing_Account__c: string;
        Status__c: string;
        Total_Amount__c: number;
        Invoice_Date__c: string;
        Due_Date__c: string;
        Payment_Status__c: string;
        Type__c: string;
        Full_Partial__c: string;
        Invoice_Amount__c: number;
      }>('Invoice__c', invoiceId, undefined, correlationId);

      return success({
        invoiceId: record.Id,
        invoiceNumber: record.Name,
        accountId: record.Billing_Account__c,
        status: record.Status__c,
        totalAmount: record.Total_Amount__c || 0,
        invoiceDate: record.Invoice_Date__c,
        dueDate: record.Due_Date__c,
        paymentStatus: record.Payment_Status__c,
        type: record.Type__c,
        fullPartial: record.Full_Partial__c,
      });
    } catch (err) {
      logger.error({ err, invoiceId }, 'Failed to fetch invoice detail');
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
