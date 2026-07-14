import {
  ISalesforceClient,
  SalesforceQueryResult,
  SalesforceDescribeResult,
  SalesforceRecord,
  ResolvedDistributorContext,
  DMSProduct,
  PrimaryOrderQuote,
  PrimaryOrder,
  PrimaryOrderDetail,
  PrimaryOrderItemDetail,
  GRNPayload,
  GRNResult,
  ReturnOrder,
  ReturnOrderDetail,
  Claim,
  ClaimPayload,
  FileUploadPayload,
  FileUploadResult,
  ApprovalResult,
  ApprovalStatus,
  CreditNote,
  SecondaryOrder,
  SecondaryOrderDetail,
  InventoryAvailability,
  InvoicePayload,
  DMSInvoice,
  DispatchRequest,
  SecondaryOrderGRN,
  FulfillmentResult,
  ArsConfig,
  ArsTriggeredOrder,
  BatchStockPolicy,
  AIBusinessInsight,
  AIStockRecommendation,
  AIUpsellRecommendation,
} from './types';
import { SalesforceAuth } from './SalesforceAuth';
import { createChildLogger } from '../utils/logger';
import { SalesforceError } from '../utils/errors';
import { invalidateCliToken } from './SalesforceCliAuth';

const logger = createChildLogger('SalesforceRestClient');

const DEFAULT_API_VERSION = '66.0';
const FETCH_TIMEOUT_MS = 8_000;

// Received quantities to write against a single GRN_Line__c row.
interface GoodsReceiptUpdate {
  lineId: string;
  receivedQty: number;
  lostQty: number;
  damagedQty: number;
}

// The subset of an existing GRN_Line__c (from getGoodsReceiptLines) needed to record receipt.
interface GoodsReceiptLineRef {
  lineId: string;
  grnId: string;
  grnNumber: string;
  productId: string;
  productName: string;
  orderedQuantity: number;
}

async function sfFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class SalesforceRestClient implements ISalesforceClient {
  private auth: SalesforceAuth;
  private apiVersion: string;
  private cliToken: { accessToken: string; instanceUrl: string } | null = null;

  constructor(auth: SalesforceAuth) {
    this.auth = auth;
    this.apiVersion = normalizeApiVersion(process.env.SALESFORCE_API_VERSION || DEFAULT_API_VERSION);
  }

  setCliToken(token: { accessToken: string; instanceUrl: string }): void {
    this.cliToken = token;
    this.apiVersion = normalizeApiVersion(process.env.SALESFORCE_API_VERSION || DEFAULT_API_VERSION);
  }

  private async getToken(): Promise<{ accessToken: string; instanceUrl: string }> {
    if (this.cliToken) return this.cliToken;
    return this.auth.getToken();
  }

  private async sfFetchWithRetry(url: string, init: RequestInit = {}, correlationId?: string): Promise<Response> {
    const log = correlationId ? createChildLogger('SalesforceRestClient', correlationId) : logger;
    const token = await this.getToken();
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> || {}) };
    if (!headers.Authorization) {
      headers.Authorization = `Bearer ${token.accessToken}`;
    }
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await sfFetch(url, { ...init, headers });

    if (response.status === 401) {
      const body = await response.text();
      const isInvalidSession = body.includes('INVALID_SESSION_ID');
      if (isInvalidSession && this.cliToken) {
        log.warn('SF CLI token expired — invalidating and fetching fresh token');
        invalidateCliToken();
        const freshToken = await this.getToken();
        headers.Authorization = `Bearer ${freshToken.accessToken}`;
        return sfFetch(url, { ...init, headers });
      }
      return new Response(body, { status: 401, headers: response.headers });
    }

    return response;
  }

  isMock(): boolean { return false; }

  async query<T = SalesforceRecord>(soql: string, correlationId?: string): Promise<SalesforceQueryResult<T>> {
    const log = correlationId ? createChildLogger('SalesforceRestClient', correlationId) : logger;
    const token = await this.getToken();
    const encodedQuery = encodeURIComponent(soql);
    const url = `${token.instanceUrl}/services/data/${this.apiVersion}/query/?q=${encodedQuery}`;

    const response = await this.sfFetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
    }, correlationId);

    if (!response.ok) {
      const body = await response.text();
      log.error({ status: response.status, body }, 'Salesforce query failed');
      throw new SalesforceError(`SOQL query failed: ${response.statusText}`, {
        userMessage: 'Unable to retrieve data from the backend system.',
      });
    }

    const result = (await response.json()) as SalesforceQueryResult<T>;
    return result;
  }

  async queryAll<T = SalesforceRecord>(
    soql: string,
    correlationId?: string,
  ): Promise<SalesforceQueryResult<T>> {
    const rows = await this.query<T>(soql, correlationId);

    if (rows.done) {
      return rows;
    }

      let nextUrl = rows.nextRecordsUrl;
      while (nextUrl) {
        const token = await this.getToken();
        const response = await this.sfFetchWithRetry(
          `${token.instanceUrl}${nextUrl}`,
          { headers: { Authorization: `Bearer ${token.accessToken}` } },
          correlationId,
        );

        if (!response.ok) {
          throw new SalesforceError(`SOQL queryAll failed: ${response.statusText}`);
        }

      const more = (await response.json()) as SalesforceQueryResult<T>;
      rows.records = rows.records.concat(more.records);
      rows.done = more.done;
      nextUrl = more.nextRecordsUrl;
    }

    rows.done = true;
    return rows;
  }

  async create(
    objectName: string,
    fields: Record<string, unknown>,
    correlationId?: string,
  ): Promise<string> {
    const log = correlationId
      ? createChildLogger('SalesforceRestClient', correlationId)
      : logger;
    log.info({ objectName }, 'Salesforce create');

    const token = await this.getToken();
    const url = `${token.instanceUrl}/services/data/${this.apiVersion}/sobjects/${objectName}`;

    const response = await this.sfFetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fields),
    }, correlationId);

    if (!response.ok) {
      const body = await response.text();
      log.error({ status: response.status, body }, 'Salesforce create failed');
      let userMessage = `Unable to create the ${objectName} record.`;
      let errorCode = '';
      try {
        const parsed = JSON.parse(body) as Array<{ message: string; errorCode: string }>;
        if (Array.isArray(parsed) && parsed[0]?.message) {
          userMessage = parsed.map((e) => e.message).join('; ');
          errorCode = parsed[0]?.errorCode || '';
        }
      } catch { /* body was not JSON */ }
      throw new SalesforceError(`Create ${objectName} failed [${errorCode || response.status}]: ${userMessage}`, {
        userMessage,
      });
    }

    const result = (await response.json()) as { id: string; success: boolean };
    if (!result.success) {
      throw new SalesforceError(`Create ${objectName} returned unsuccessful`);
    }

    return result.id;
  }

  async update(
    objectName: string,
    id: string,
    fields: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const log = correlationId
      ? createChildLogger('SalesforceRestClient', correlationId)
      : logger;
    log.info({ objectName, id }, 'Salesforce update');

    const token = await this.getToken();
    const url = `${token.instanceUrl}/services/data/${this.apiVersion}/sobjects/${objectName}/${id}`;

    const response = await this.sfFetchWithRetry(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fields),
    }, correlationId);

    if (!response.ok) {
      const body = await response.text();
      log.error({ status: response.status, body }, 'Salesforce update failed');
      throw new SalesforceError(`Update ${objectName}/${id} failed`, {
        userMessage: `Unable to update the ${objectName} record.`,
      });
    }
  }

  async delete(
    objectName: string,
    id: string,
    correlationId?: string,
  ): Promise<void> {
    const log = correlationId
      ? createChildLogger('SalesforceRestClient', correlationId)
      : logger;
    log.info({ objectName, id }, 'Salesforce delete');

    const token = await this.getToken();
    const url = `${token.instanceUrl}/services/data/${this.apiVersion}/sobjects/${objectName}/${id}`;

    const response = await this.sfFetchWithRetry(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    }, correlationId);

    if (!response.ok) {
      const body = await response.text();
      log.error({ status: response.status, body }, 'Salesforce delete failed');
      throw new SalesforceError(`Delete ${objectName}/${id} failed`, {
        userMessage: `Unable to delete the ${objectName} record.`,
      });
    }
  }

  async describe(
    objectName: string,
    correlationId?: string,
  ): Promise<SalesforceDescribeResult> {
    const log = correlationId
      ? createChildLogger('SalesforceRestClient', correlationId)
      : logger;
    log.info({ objectName }, 'Salesforce describe');

    const token = await this.getToken();
    const url = `${token.instanceUrl}/services/data/${this.apiVersion}/sobjects/${objectName}/describe`;

    const response = await this.sfFetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
    }, correlationId);

    if (!response.ok) {
      throw new SalesforceError(`Describe ${objectName} failed: ${response.statusText}`);
    }

    return (await response.json()) as SalesforceDescribeResult;
  }

  async getRecord<T = SalesforceRecord>(
    objectName: string,
    id: string,
    fields?: string[],
    correlationId?: string,
  ): Promise<T> {
    const log = correlationId
      ? createChildLogger('SalesforceRestClient', correlationId)
      : logger;
    log.info({ objectName, id }, 'Salesforce getRecord');

    const token = await this.getToken();
    let url = `${token.instanceUrl}/services/data/${this.apiVersion}/sobjects/${objectName}/${id}`;
    if (fields && fields.length > 0) {
      url += `?fields=${fields.join(',')}`;
    }

    const response = await this.sfFetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
    }, correlationId);

    if (!response.ok) {
      throw new SalesforceError(`Get ${objectName}/${id} failed`, {
        userMessage: 'Unable to retrieve the record.',
      });
    }

    return (await response.json()) as T;
  }

  private async createOrderWithFallback(
    recordData: Record<string, unknown>,
    log: ReturnType<typeof createChildLogger>,
    correlationId?: string,
  ): Promise<string> {
    try {
      return await this.create('Order', recordData, correlationId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isFieldError = msg.includes('INVALID_FIELD') || msg.includes('No such column') || msg.includes('INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST');
      if (!isFieldError) throw err;
      log.warn({ rejectedFields: Object.keys(recordData).filter((k) => k.endsWith('__c')) }, 'Order create rejected custom fields — retrying with standard fields only');
      const standardData: Record<string, unknown> = {
        AccountId: recordData.AccountId,
        Pricebook2Id: recordData.Pricebook2Id,
        Type: recordData.Type,
        EffectiveDate: recordData.EffectiveDate,
        Status: recordData.Status,
        Description: recordData.Description,
      };
      return await this.create('Order', standardData, correlationId);
    }
  }

  private async getPreferredPricebook(correlationId?: string): Promise<{ id: string; name: string }> {
    const result = await this.query<{ Id: string; Name: string }>(
      "SELECT Id, Name FROM Pricebook2 WHERE IsActive = true AND Name = 'RCG PriceBook' LIMIT 1",
      correlationId,
    );
    if (result.records[0]) return { id: result.records[0].Id, name: result.records[0].Name };

    const fallback = await this.query<{ Id: string; Name: string }>(
      'SELECT Id, Name FROM Pricebook2 WHERE IsActive = true AND IsStandard = true LIMIT 1',
      correlationId,
    );
    if (fallback.records[0]) return { id: fallback.records[0].Id, name: fallback.records[0].Name };

    throw new SalesforceError('No active pricebook found', {
      userMessage: 'Unable to create an order because no active Salesforce pricebook was found.',
    });
  }

  private async getOrderItems(orderId: string, correlationId?: string): Promise<PrimaryOrderItemDetail[]> {
    const escapedOrderId = escapeSoql(orderId);
    const result = await this.query<{
      Id: string;
      Product2Id: string;
      Product2?: { Name?: string; ProductCode?: string };
      Quantity: number;
      Remaining_Qty__c?: number;
      UnitPrice: number;
      TotalPrice: number;
      Unit_Of_Measure__c?: string;
    }>(
      `SELECT Id, Product2Id, Product2.Name, Product2.ProductCode, Quantity, Remaining_Qty__c, UnitPrice, TotalPrice, Unit_Of_Measure__c FROM OrderItem WHERE OrderId = '${escapedOrderId}' ORDER BY CreatedDate ASC`,
      correlationId,
    );

    return result.records.map((r) => ({
      itemId: r.Id,
      productId: r.Product2Id,
      productName: r.Product2?.Name || r.Product2Id,
      productCode: r.Product2?.ProductCode || '',
      quantity: r.Quantity || 0,
      unitPrice: r.UnitPrice || 0,
      totalPrice: r.TotalPrice || 0,
      unitOfMeasure: r.Unit_Of_Measure__c || 'Each',
      fulfilledQuantity: r.Remaining_Qty__c != null ? Math.max(0, (r.Quantity || 0) - r.Remaining_Qty__c) : 0,
      expectedQuantity: r.Quantity || 0,
      deliveryStatus: 'Pending',
      remainingQty: r.Remaining_Qty__c,
    }));
  }

  private async getRelatedIds(objectName: string, idField: string, orderId: string, correlationId?: string): Promise<string[]> {
    const result = await this.query<{ Id: string }>(
      `SELECT Id FROM ${objectName} WHERE ${idField} = '${escapeSoql(orderId)}' ORDER BY CreatedDate DESC LIMIT 50`,
      correlationId,
    );
    return result.records.map((r) => r.Id);
  }

  private async calculateAutoSchemeDiscount(
    quoteLines: PrimaryOrderQuote['lineItems'],
    correlationId?: string,
  ): Promise<{ amount: number; descriptions: string[] }> {
    const totalAmount = quoteLines.reduce((sum, line) => sum + line.totalPrice, 0);
    try {
      const result = await this.query<{
        Id: string;
        Name: string;
        Product__c?: string;
        Product_Code__c?: string;
        Product_name__c?: string;
        Discount_Type__c?: string;
        Discount__c?: number;
        Flat_Amount__c?: number;
        CN_Amount__c?: number;
        Payout_per_Qty__c?: number;
        Min_Quantity__c?: number;
        Max_Quantity__c?: number;
        Buy_Value_From__c?: number;
        Buy_Value_To__c?: number;
      }>(
        `SELECT Id, Name, Product__c, Product_Code__c, Product_name__c, Discount_Type__c, Discount__c, Flat_Amount__c, CN_Amount__c, Payout_per_Qty__c, Min_Quantity__c, Max_Quantity__c, Buy_Value_From__c, Buy_Value_To__c FROM Scheme_Slab_Target__c ORDER BY Discount__c DESC NULLS LAST LIMIT 200`,
        correlationId,
      );

      let totalDiscount = 0;
      const descriptions: string[] = [];
      for (const line of quoteLines) {
        const eligible = result.records
          .filter((slab) => !slab.Product__c || slab.Product__c === line.productId)
          .filter((slab) => !slab.Product_Code__c || slab.Product_Code__c === line.productCode)
          .filter((slab) => !slab.Min_Quantity__c || line.quantity >= slab.Min_Quantity__c)
          .filter((slab) => !slab.Max_Quantity__c || line.quantity <= slab.Max_Quantity__c)
          .filter((slab) => !slab.Buy_Value_From__c || totalAmount >= slab.Buy_Value_From__c)
          .filter((slab) => !slab.Buy_Value_To__c || totalAmount <= slab.Buy_Value_To__c)
          .map((slab) => {
            const isProductSpecific = Boolean(slab.Product__c || slab.Product_Code__c);
            const discountType = (slab.Discount_Type__c || 'Percent').toLowerCase();
            const percentDiscount = slab.Discount__c && discountType.includes('percent')
              ? line.totalPrice * (slab.Discount__c / 100)
              : 0;
            const flatDiscount = isProductSpecific ? slab.Flat_Amount__c || slab.CN_Amount__c || 0 : 0;
            const payoutDiscount = isProductSpecific && slab.Payout_per_Qty__c ? slab.Payout_per_Qty__c * line.quantity : 0;
            const amount = Math.min(Math.max(percentDiscount, flatDiscount, payoutDiscount), line.totalPrice);
            return { slab, amount };
          })
          .filter((candidate) => candidate.amount > 0)
          .sort((a, b) => b.amount - a.amount);
        const best = eligible[0];
        if (best) {
          totalDiscount += best.amount;
          descriptions.push(`${best.slab.Name}: ${line.productName} - Rs ${best.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
        }
      }
      return { amount: Math.min(totalDiscount, totalAmount), descriptions };
    } catch (err) {
      logger.warn({ err }, 'Unable to calculate scheme discount from Scheme_Slab_Target__c');
      return { amount: 0, descriptions: [] };
    }
  }

  async getAvailableProducts(
    _context: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<DMSProduct[]> {
    const log = correlationId ? createChildLogger('SalesforceRestClient', correlationId) : logger;
    try {
      const pricebook = await this.getPreferredPricebook(correlationId);
      const result = await this.query<{
        Id: string;
        Product2Id: string;
        UnitPrice: number;
        Pricebook2Id: string;
        Product2: {
          Name: string; ProductCode: string; Family: string;
          IsActive: boolean; Unit_Of_Measure__c: string; Pack_Size__c: number;
          Product_Category__c: string; Minimum_Order_Quantity_Primary__c: number;
          Minimum_Order_Quantity_Secondary__c: number;
        };
      }>(`SELECT Id, Product2Id, UnitPrice, Pricebook2Id, Product2.Name, Product2.ProductCode, Product2.Family, Product2.IsActive, Product2.Unit_Of_Measure__c, Product2.Pack_Size__c, Product2.Product_Category__c, Product2.Minimum_Order_Quantity_Primary__c, Product2.Minimum_Order_Quantity_Secondary__c FROM PricebookEntry WHERE IsActive = true AND Pricebook2Id = '${pricebook.id}' AND Product2.IsActive = true ORDER BY Product2.Name LIMIT 200`, correlationId);
      return result.records.map((r) => ({
        productId: r.Product2Id, pricebookEntryId: r.Id, pricebookId: r.Pricebook2Id,
        productCode: r.Product2.ProductCode, productName: r.Product2.Name,
        family: r.Product2.Family, category: r.Product2.Product_Category__c,
        unitOfMeasure: r.Product2.Unit_Of_Measure__c || 'Each', unitPrice: r.UnitPrice || 0,
        packSize: r.Product2.Pack_Size__c || 0, isActive: r.Product2.IsActive,
        minOrderQtyPrimary: r.Product2.Minimum_Order_Quantity_Primary__c ?? null,
        minOrderQtySecondary: r.Product2.Minimum_Order_Quantity_Secondary__c ?? null,
      }));
    } catch (err) {
      log.error({ err }, 'Failed to fetch products');
      throw new SalesforceError('Failed to fetch products', { userMessage: 'Unable to load product catalog.' });
    }
  }

  async calculatePrimaryOrderQuote(
    _context: ResolvedDistributorContext,
    lineItems: Array<{ productId: string; quantity: number; schemeDiscount?: number }>,
    creditNoteIdsOrCorrelationId: string[] | string = [],
    correlationId?: string,
  ): Promise<PrimaryOrderQuote> {
    const creditNoteIds = Array.isArray(creditNoteIdsOrCorrelationId) ? creditNoteIdsOrCorrelationId : [];
    const effectiveCorrelationId = Array.isArray(creditNoteIdsOrCorrelationId) ? correlationId : creditNoteIdsOrCorrelationId;
    const products = await this.getAvailableProducts(_context, effectiveCorrelationId);
    const quoteLines = lineItems.map((item) => {
      const product = products.find((p) => p.productId === item.productId);
      if (!product) {
        throw new SalesforceError('Selected product not found', {
          userMessage: 'One of the selected products is no longer available.',
        });
      }
      const unitPrice = product.unitPrice || 0;
      return {
        productId: product.productId,
        pricebookEntryId: product.pricebookEntryId,
        productCode: product.productCode,
        productName: product.productName,
        quantity: item.quantity,
        unitPrice,
        totalPrice: unitPrice * item.quantity,
        unitOfMeasure: product.unitOfMeasure,
      };
    });
    const totalAmount = quoteLines.reduce((sum, line) => sum + line.totalPrice, 0);
    const autoScheme = await this.calculateAutoSchemeDiscount(quoteLines, effectiveCorrelationId);
    const schemeDiscount = autoScheme.amount;
    const availableCreditNotes = await this.getCreditNotes(_context, undefined, effectiveCorrelationId);
    let remainingCreditCapacity = Math.max(totalAmount - schemeDiscount, 0);
    const appliedCreditNotes = creditNoteIds
      .map((id) => availableCreditNotes.find((note) => note.creditNoteId === id))
      .filter((note): note is NonNullable<typeof note> => Boolean(note))
      .map((note) => {
        const available = Math.max(0, note.availableAmount ?? note.amount ?? 0);
        const amount = Math.min(available, remainingCreditCapacity);
        remainingCreditCapacity -= amount;
        return { creditNoteId: note.creditNoteId, creditNoteNumber: note.creditNoteNumber, amount };
      })
      .filter((note) => note.amount > 0);
    const creditApplied = appliedCreditNotes.reduce((sum, note) => sum + note.amount, 0);
    return {
      quoteId: `quote-${Date.now()}`,
      lineItems: quoteLines,
      totalAmount,
      schemeDiscount,
      discountAmount: 0,
      creditApplied,
      taxAmount: 0,
      grandTotal: Math.max(totalAmount - schemeDiscount - creditApplied, 0),
      appliedSchemes: autoScheme.descriptions,
      appliedOffers: [],
      appliedCreditNotes,
      eligibleCreditNotes: availableCreditNotes.filter((note) => (note.availableAmount ?? note.amount) > 0),
      calculatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      currency: 'INR',
    };
  }

  async createPrimaryOrder(
    context: ResolvedDistributorContext,
    quote: PrimaryOrderQuote,
    correlationId?: string,
  ): Promise<PrimaryOrder> {
    const log = correlationId ? createChildLogger('SalesforceRestClient', correlationId) : logger;
    let orderId = '';
    try {
      const today = new Date().toISOString().split('T')[0];
      const pricebook = await this.getPreferredPricebook(correlationId);
      const recordData = {
        AccountId: context.salesforceAccountId,
        Distributor_Account__c: context.salesforceAccountId,
        Pricebook2Id: pricebook.id,
        Type: 'Primary',
        EffectiveDate: today,
        Status: 'Draft',
        Grand_Total__c: quote.grandTotal,
        Discount_Amount__c: quote.schemeDiscount + quote.discountAmount,
        HasAppliedScheme__c: quote.schemeDiscount > 0,
        Scheme_Code__c: quote.appliedSchemes.join(', ').slice(0, 15),
        Credit_Applied__c: quote.creditApplied || 0,
        Tax_Amount__c: quote.taxAmount,
        Approval_Status__c: 'None',
        Order_Products__c: quote.lineItems
          .map((li) => `${li.productCode || li.productId}: ${li.quantity} ${li.unitOfMeasure || ''}`.trim())
          .join('\n'),
        Description: `Created from Slack DMSFA for ${context.accountName} (${context.slackEmail})`,
      };
      orderId = await this.createOrderWithFallback(recordData, log, correlationId);
      for (const line of quote.lineItems) {
        if (!line.pricebookEntryId) {
          throw new SalesforceError('Missing pricebook entry on quote line', {
            userMessage: `Unable to create an order line for ${line.productName}; no active pricebook entry was found.`,
          });
        }
        await this.create('OrderItem', {
          OrderId: orderId,
          PricebookEntryId: line.pricebookEntryId,
          Product2Id: line.productId,
          Quantity: line.quantity,
          UnitPrice: line.unitPrice,
          Unit_Of_Measure__c: line.unitOfMeasure,
          Original_Unit_Price__c: line.unitPrice,
          Total_Amount_with_Tax__c: line.totalPrice,
        }, correlationId);
      }
      for (const note of quote.appliedCreditNotes || []) {
        await this.create('Credit_Note_Usage__c', {
          Credit_Note__c: note.creditNoteId,
          Account__c: context.salesforceAccountId,
          Order__c: orderId,
          Status__c: 'Applied',
          Usage_Date__c: today,
          Used_Amount__c: note.amount,
        }, correlationId);
      }
      try {
        await this.update('Order', orderId, { Status: 'Order Placed' }, correlationId);
      } catch (statusErr) {
        log.warn({ err: statusErr }, 'Failed to update Order status to "Order Placed"');
        log.warn('Order was created in Draft status. Status update may require manual intervention or org-side automation.');
      }
      const created = await this.getRecord<{
        Id: string;
        OrderNumber?: string;
      }>('Order', orderId, ['Id', 'OrderNumber'], correlationId);
      return {
        orderId, orderNumber: created.OrderNumber || orderId,
        distributorId: context.salesforceAccountId, status: 'Draft',
        totalAmount: quote.totalAmount, schemeDiscount: quote.schemeDiscount,
        discountAmount: quote.discountAmount, grandTotal: quote.grandTotal,
        taxAmount: quote.taxAmount, orderDate: today,
        items: quote.lineItems.map((li, idx) => ({
          itemId: `item-${idx}-${li.productId.slice(-4)}`,
          productId: li.productId, productName: li.productName,
          productCode: li.productCode, quantity: li.quantity,
          unitPrice: li.unitPrice, totalPrice: li.totalPrice,
          unitOfMeasure: li.unitOfMeasure,
        })),
        approvalStatus: 'None',
        creditApplied: quote.creditApplied || 0,
        appliedCreditNotes: quote.appliedCreditNotes || [],
      };
    } catch (err) {
      log.error({ err }, 'Failed to create order');
      if (err instanceof SalesforceError) {
        throw err;
      }
      throw new SalesforceError('Order creation failed', {
        userMessage: orderId
          ? `Order header was created in Salesforce (${orderId}), but one or more line items failed. The order was left in Draft for review.`
          : 'Unable to create order. Please try again.',
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  async getPrimaryOrders(context: ResolvedDistributorContext, correlationId?: string): Promise<PrimaryOrder[]> {
    try {
      const soql = `SELECT Id, OrderNumber, AccountId, Status, Type, EffectiveDate, TotalAmount, Grand_Total__c, Discount_Amount__c, Credit_Applied__c, Tax_Amount__c, Approval_Status__c FROM Order WHERE AccountId = '${escapeSoql(context.salesforceAccountId)}' AND Type = 'Primary' ORDER BY CreatedDate DESC LIMIT 50`;
      const result = await this.query<{ Id: string; OrderNumber: string; AccountId: string; Status: string; EffectiveDate: string; TotalAmount: number; Grand_Total__c: number; Discount_Amount__c: number; Credit_Applied__c: number; Tax_Amount__c: number; Approval_Status__c: string }>(soql, correlationId);
      return result.records.map((r) => ({
        orderId: r.Id, orderNumber: r.OrderNumber, distributorId: r.AccountId,
        status: r.Status, totalAmount: r.TotalAmount || r.Grand_Total__c || 0,
        schemeDiscount: r.Discount_Amount__c || 0, discountAmount: 0,
        grandTotal: r.Grand_Total__c || r.TotalAmount || 0, taxAmount: r.Tax_Amount__c || 0,
        orderDate: r.EffectiveDate, items: [], approvalStatus: r.Approval_Status__c || r.Status,
        creditApplied: r.Credit_Applied__c || 0,
      }));
    } catch (err) {
      throw new SalesforceError('Failed to fetch orders', { userMessage: 'Unable to load your orders.', cause: err instanceof Error ? err : undefined });
    }
  }

  async getPrimaryOrderDetails(context: ResolvedDistributorContext, orderId: string, correlationId?: string): Promise<PrimaryOrderDetail> {
    try {
      const escapedsfAccountId = escapeSoql(context.salesforceAccountId);
      const escapedOrderId = escapeSoql(orderId);
      const soql = `SELECT Id, OrderNumber, AccountId, Status, Type, EffectiveDate, TotalAmount, Grand_Total__c, Discount_Amount__c, Credit_Applied__c, Tax_Amount__c, Approval_Status__c, Order_Products__c, Description FROM Order WHERE Id = '${escapedOrderId}' AND AccountId = '${escapedsfAccountId}' AND Type = 'Primary' LIMIT 1`;
      const result = await this.query<{ Id: string; OrderNumber: string; AccountId: string; Status: string; EffectiveDate: string; TotalAmount: number; Grand_Total__c: number; Discount_Amount__c: number; Credit_Applied__c: number; Tax_Amount__c: number; Approval_Status__c: string; Order_Products__c?: string }>(soql, correlationId);
      if (result.records.length === 0) throw new SalesforceError('Order not found or access denied');
      const r = result.records[0];
      const items = await this.getOrderItems(r.Id, correlationId);
      const grnIds = await this.getRelatedIds('Goods_Receipt__c', 'Order__c', r.Id, correlationId);
      const returnOrderIds = await this.getRelatedIds('Return_Order__c', 'Order__c', r.Id, correlationId);
      const invoiceIds = await this.getRelatedIds('Invoice__c', 'Order__c', r.Id, correlationId);
      const dispatchIds = await this.getRelatedIds('Dispatch_Request__c', 'Order__c', r.Id, correlationId);
      const creditNoteUsageIds = await this.getRelatedIds('Credit_Note_Usage__c', 'Order__c', r.Id, correlationId);
      return {
        orderId: r.Id, orderNumber: r.OrderNumber, distributorId: r.AccountId,
        status: r.Status, totalAmount: r.TotalAmount || r.Grand_Total__c || 0,
        schemeDiscount: r.Discount_Amount__c || 0, discountAmount: 0,
        grandTotal: r.Grand_Total__c || r.TotalAmount || 0, taxAmount: r.Tax_Amount__c || 0,
        orderDate: r.EffectiveDate, items,
        approvalStatus: r.Approval_Status__c || r.Status, fulfillmentStatus: 'Unknown',
        grnIds, returnOrderIds, invoiceIds, dispatchIds,
        creditApplied: r.Credit_Applied__c || 0, creditNoteUsageIds,
      };
    } catch (err) {
      throw new SalesforceError('Failed to fetch order details', { userMessage: 'Unable to load order details.', cause: err instanceof Error ? err : undefined });
    }
  }

  // GRN receiving for a PRIMARY order. The Goods_Receipt__c header and its GRN_Line__c
  // rows are auto-created by the "Create_GRN_on_Order_Process" flow when the order reaches
  // Delivered. This method does NOT create records — it records the received/short/damaged
  // quantities against those existing lines. Inventory is then posted automatically by the
  // "Create_Inventory_On_GRN_line_Item" flow.
  async createOrUpdateGRN(context: ResolvedDistributorContext, orderId: string, grnData: GRNPayload, correlationId?: string): Promise<GRNResult> {
    try {
      // App-enforced authorization: confirm the order belongs to this distributor.
      const order = await this.query<{ Id: string }>(
        `SELECT Id FROM Order WHERE Id = '${escapeSoql(orderId)}' AND AccountId = '${escapeSoql(context.salesforceAccountId)}' LIMIT 1`,
        correlationId,
      );
      if (order.records.length === 0) {
        throw new SalesforceError('Order not found for GRN', {
          userMessage: 'Unable to process GRN because the order was not found for your distributor account.',
        });
      }

      const lines = await this.getGoodsReceiptLines(context, orderId, correlationId);
      if (lines.length === 0) {
        throw new SalesforceError('No GRN lines found for order', {
          userMessage: 'The Goods Receipt Note for this order has not been generated yet. It is created automatically once the order is marked Delivered in Salesforce — please try again shortly.',
        });
      }

      // Map submitted quantities (keyed by product) onto the existing GRN lines.
      const lineByProduct = new Map(lines.map((line) => [line.productId, line]));
      const updates: GoodsReceiptUpdate[] = [];
      for (const item of grnData.items) {
        const line = lineByProduct.get(item.productId);
        if (!line) continue; // product not part of the generated GRN — skip
        updates.push({
          lineId: line.lineId,
          receivedQty: item.receivedQuantity,
          lostQty: item.missingQuantity,
          damagedQty: item.damagedQuantity,
        });
      }
      if (updates.length === 0) {
        throw new SalesforceError('No matching GRN lines', { userMessage: 'None of the submitted products matched the generated GRN lines for this order.' });
      }

      const applied = await this.applyGoodsReceipt(lines, updates, correlationId);

      return {
        grnId: applied.grnId,
        grnNumber: applied.grnNumber,
        orderId,
        status: applied.headerStatus,
        items: grnData.items.map((i) => ({
          productId: i.productId,
          receivedQuantity: i.receivedQuantity,
          damagedQuantity: i.damagedQuantity,
          missingQuantity: i.missingQuantity,
        })),
        notes: grnData.notes,
      };
    } catch (err) {
      if (err instanceof SalesforceError) throw err;
      throw new SalesforceError('GRN update failed', { userMessage: 'Unable to process GRN.', cause: err instanceof Error ? err : undefined });
    }
  }

  // Mirrors the org's GRN_Line_Status__c formula: derive the line Status__c picklist value
  // from the received/short/damaged quantities.
  private deriveGrnLineStatus(receivedQty: number, shortQty: number, damagedQty: number): string {
    if (receivedQty > 0 && shortQty === 0 && damagedQty === 0) return 'Fully Received';
    if (receivedQty === 0 && (shortQty > 0 || damagedQty > 0)) return 'Fully Return';
    if (receivedQty === 0 && shortQty === 0 && damagedQty === 0) return 'New';
    return 'Partially Received';
  }

  // Update existing GRN_Line__c rows with received quantities and roll the Goods_Receipt__c
  // header status up. Updating Quantity_Received__c fires the inventory flow automatically.
  private async applyGoodsReceipt(
    lines: GoodsReceiptLineRef[],
    updates: GoodsReceiptUpdate[],
    correlationId?: string,
  ): Promise<{ grnId: string; grnNumber: string; headerStatus: string }> {
    const lineById = new Map(lines.map((line) => [line.lineId, line]));
    let grnId = '';
    let grnNumber = '';
    let allFullyReceived = true;
    let anyReceived = false;

    for (const upd of updates) {
      const line = lineById.get(upd.lineId);
      if (!line) {
        throw new SalesforceError('GRN line not found for this order', { userMessage: 'Unable to update GRN because one line item no longer belongs to this order.' });
      }
      const totalQty = upd.receivedQty + upd.lostQty + upd.damagedQty;
      if (totalQty > line.orderedQuantity) {
        throw new SalesforceError('GRN quantity exceeds ordered quantity', { userMessage: `For ${line.productName}, received + lost/short + damaged cannot exceed ordered quantity (${line.orderedQuantity}).` });
      }
      grnId = line.grnId;
      grnNumber = line.grnNumber;

      const lineStatus = this.deriveGrnLineStatus(upd.receivedQty, upd.lostQty, upd.damagedQty);
      if (lineStatus !== 'Fully Received') allFullyReceived = false;
      if (upd.receivedQty > 0) anyReceived = true;

      await this.update('GRN_Line__c', upd.lineId, {
        Quantity_Received__c: upd.receivedQty,
        Short_Quantity__c: upd.lostQty,
        Damage_Quantity__c: upd.damagedQty,
        Status__c: lineStatus,
      }, correlationId);
    }

    // Header status: Full only when every submitted line was received in full; Full Order
    // Return when nothing was received; otherwise Partial.
    const headerStatus = allFullyReceived ? 'Full Order Received' : anyReceived ? 'Partial Order Received' : 'Full Order Return';
    if (grnId) {
      try {
        await this.update('Goods_Receipt__c', grnId, { Status__c: headerStatus }, correlationId);
      } catch (err) {
        logger.warn({ err, grnId }, 'Failed to update Goods_Receipt__c header status (non-fatal — line updates already saved)');
      }
    }

    return { grnId, grnNumber, headerStatus };
  }

  async getGRNDetails(_context: ResolvedDistributorContext, grnId: string, correlationId?: string): Promise<GRNResult> {
    try {
      const r = await this.getRecord<{ Id: string; Name: string; Status__c: string; Order__c: string }>('Goods_Receipt__c', grnId, undefined, correlationId);
      return {
        grnId: r.Id, grnNumber: r.Name, orderId: r.Order__c || '',
        status: r.Status__c, items: [], notes: '',
      };
    } catch (err) {
      throw new SalesforceError('GRN details fetch failed', { userMessage: 'Unable to load GRN details.' });
    }
  }

  async getReturnOrders(context: ResolvedDistributorContext, correlationId?: string): Promise<ReturnOrder[]> {
    try {
      const soql = `SELECT Id, Name, Account__c, Order__c, Status__c, Grand_Total__c, Description__c, Type__c FROM Return_Order__c WHERE Account__c = '${escapeSoql(context.salesforceAccountId)}' ORDER BY CreatedDate DESC LIMIT 50`;
      const result = await this.query<{ Id: string; Name: string; Account__c: string; Order__c?: string; Status__c: string; Grand_Total__c: number; Description__c: string; Type__c: string }>(soql, correlationId);
      return result.records.map((r) => ({
        returnId: r.Id, returnNumber: r.Name, accountId: r.Account__c,
        orderId: r.Order__c,
        status: r.Status__c, grandTotal: r.Grand_Total__c || 0,
        description: r.Description__c, type: r.Type__c, items: [],
      }));
    } catch (err) {
      throw new SalesforceError('Failed to fetch return orders', { userMessage: 'Unable to load return orders.' });
    }
  }

  async getReturnOrderDetails(context: ResolvedDistributorContext, returnOrderId: string, correlationId?: string): Promise<ReturnOrderDetail> {
    try {
      const escapedsfAccountId = escapeSoql(context.salesforceAccountId);
      const escapedId = escapeSoql(returnOrderId);
      const soql = `SELECT Id, Name, Account__c, Order__c, Status__c, Grand_Total__c, Description__c, Type__c FROM Return_Order__c WHERE Id = '${escapedId}' AND Account__c = '${escapedsfAccountId}' LIMIT 1`;
      const result = await this.query<{ Id: string; Name: string; Account__c: string; Order__c?: string; Status__c: string; Grand_Total__c: number; Description__c: string; Type__c: string }>(soql, correlationId);
      if (result.records.length === 0) throw new SalesforceError('Return order not found');
      const r = result.records[0];
      const claims = await this.getClaims(context, r.Id, correlationId);
      const creditNotes = await this.getCreditNotes(context, r.Id, correlationId);
      return {
        returnId: r.Id, returnNumber: r.Name, accountId: r.Account__c, orderId: r.Order__c,
        status: r.Status__c, grandTotal: r.Grand_Total__c || 0,
        description: r.Description__c, type: r.Type__c, items: [],
        approvalStatus: r.Status__c, claimIds: claims.map((c) => c.claimId), creditNoteIds: creditNotes.map((c) => c.creditNoteId),
      };
    } catch (err) {
      throw new SalesforceError('Failed to fetch return order details');
    }
  }

  async getClaims(context: ResolvedDistributorContext, returnOrderId?: string, correlationId?: string): Promise<Claim[]> {
    try {
      let soql: string;
      if (returnOrderId) {
        const returnOrder = await this.query<{ Id: string }>(
          `SELECT Id FROM Return_Order__c WHERE Id = '${escapeSoql(returnOrderId)}' AND Account__c = '${escapeSoql(context.salesforceAccountId)}' LIMIT 1`,
          correlationId,
        );
        if (returnOrder.records.length === 0) return [];
        soql = `SELECT Id, Name, Order__c, Return_Order__c, Claim_Type__c, Status__c, Amount__c, Total_Amount__c, Claim_Number__c FROM Claim__c WHERE Return_Order__c = '${escapeSoql(returnOrderId)}' ORDER BY CreatedDate DESC LIMIT 50`;
      } else {
        const orders = await this.query<{ Id: string }>(
          `SELECT Id FROM Order WHERE AccountId = '${escapeSoql(context.salesforceAccountId)}' LIMIT 200`,
          correlationId,
        );
        if (orders.records.length === 0) return [];
        soql = `SELECT Id, Name, Order__c, Return_Order__c, Claim_Type__c, Status__c, Amount__c, Total_Amount__c, Claim_Number__c FROM Claim__c WHERE Order__c IN (${orders.records.map((o) => `'${escapeSoql(o.Id)}'`).join(',')}) ORDER BY CreatedDate DESC LIMIT 50`;
      }
      const result = await this.query<{ Id: string; Name: string; Order__c?: string; Return_Order__c?: string; Claim_Type__c: string; Status__c: string; Amount__c: number; Total_Amount__c: number; Claim_Number__c: string }>(soql, correlationId);
      return result.records.map((r) => ({
        claimId: r.Id, claimNumber: r.Claim_Number__c || r.Name, accountId: context.salesforceAccountId,
        orderId: r.Order__c, returnOrderId: r.Return_Order__c, claimType: r.Claim_Type__c, status: r.Status__c,
        amount: r.Amount__c || 0, totalAmount: r.Total_Amount__c || 0,
      }));
    } catch (err) {
      throw new SalesforceError('Failed to fetch claims', { userMessage: 'Unable to load claims.' });
    }
  }

  async createOrUpdateClaim(context: ResolvedDistributorContext, claimData: ClaimPayload, correlationId?: string): Promise<Claim> {
    try {
      const recordData: Record<string, unknown> = {
        Retailer_Account__c: context.salesforceAccountId, Claim_Type__c: claimData.claimType,
        Status__c: 'Open', Amount__c: claimData.amount,
        Total_Amount__c: claimData.amount,
      };
      if (claimData.returnOrderId) recordData.Return_Order__c = claimData.returnOrderId;
      const claimId = await this.create('Claim__c', recordData, correlationId);
      return {
        claimId, claimNumber: `CLM-${claimId.slice(-4)}`, accountId: context.salesforceAccountId,
        claimType: claimData.claimType, status: 'Open',
        amount: claimData.amount, totalAmount: claimData.amount,
        notes: claimData.description,
      };
    } catch (err) {
      throw new SalesforceError('Claim creation failed', { userMessage: 'Unable to create claim.' });
    }
  }

  async uploadFileToRecord(_context: ResolvedDistributorContext, recordId: string, filePayload: FileUploadPayload, correlationId?: string): Promise<FileUploadResult> {
    const log = correlationId ? createChildLogger('SalesforceRestClient', correlationId) : logger;
    try {
      const cvId = await this.create('ContentVersion', {
        Title: filePayload.fileName, PathOnClient: filePayload.fileName,
        VersionData: filePayload.contentBase64, IsMajorVersion: true,
        Description: filePayload.description || '',
      }, correlationId);
      const cvRecord = await this.query<{ Id: string; ContentDocumentId: string }>(`SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = '${cvId}'`, correlationId);
      if (cvRecord.records.length === 0) throw new Error('ContentVersion not found after create');
      const contentDocumentId = cvRecord.records[0].ContentDocumentId;
      await this.create('ContentDocumentLink', {
        ContentDocumentId: contentDocumentId, LinkedEntityId: recordId,
        ShareType: 'V', Visibility: 'AllUsers',
      }, correlationId);
      return { fileId: cvId, contentDocumentId, linkedToRecord: recordId };
    } catch (err) {
      log.error({ err }, 'File upload failed');
      throw new SalesforceError('File upload failed', { userMessage: 'Unable to upload file.', cause: err instanceof Error ? err : undefined });
    }
  }

  async submitForApproval(_context: ResolvedDistributorContext, recordId: string, _objectName: string, correlationId?: string): Promise<ApprovalResult> {
    const log = correlationId ? createChildLogger('SalesforceRestClient', correlationId) : logger;
    log.warn('Approval submission: No accessible REST endpoint. Blocked by BLK-005.');
    return { success: false, newStatus: 'Unknown', message: 'Approval submission not available via existing Salesforce REST API.' };
  }

  async getApprovalStatus(_context: ResolvedDistributorContext, recordId: string, objectName: string, correlationId?: string): Promise<ApprovalStatus> {
    try {
      const soql = `SELECT Id, Approval_Status__c FROM ${objectName} WHERE Id = '${escapeSoql(recordId)}' LIMIT 1`;
      const result = await this.query<{ Id: string; Approval_Status__c: string }>(soql, correlationId);
      const status = result.records[0]?.Approval_Status__c || 'Unknown';
      return { recordId, status, isPending: status === 'Pending', isApproved: status === 'Approved', isRejected: status === 'Rejected' };
    } catch (err) {
      return { recordId, status: 'Unknown', isPending: false, isApproved: false, isRejected: false };
    }
  }

  async getCreditNotes(context: ResolvedDistributorContext, returnOrderId?: string, correlationId?: string): Promise<CreditNote[]> {
    try {
      const filter = returnOrderId ? ` AND Return_Order__c = '${escapeSoql(returnOrderId)}'` : '';
      const soql = `SELECT Id, Name, Account__c, Status__c, Amount__c, Used_Amount__c, Available_Amount__c, Return_Order__c, Claim__c FROM Credit_Note__c WHERE Account__c = '${escapeSoql(context.salesforceAccountId)}'${filter} ORDER BY CreatedDate DESC LIMIT 50`;
      const result = await this.query<{ Id: string; Name: string; Account__c: string; Status__c: string; Amount__c: number; Used_Amount__c?: number; Available_Amount__c?: number; Return_Order__c?: string; Claim__c?: string }>(soql, correlationId);
      return result.records.map((r) => ({
        creditNoteId: r.Id, creditNoteNumber: r.Name, accountId: r.Account__c,
        returnOrderId: r.Return_Order__c, claimId: r.Claim__c, status: r.Status__c, amount: r.Amount__c || 0,
        usedAmount: r.Used_Amount__c || 0, availableAmount: r.Available_Amount__c ?? r.Amount__c ?? 0,
      }));
    } catch (err) {
      throw new SalesforceError('Failed to fetch credit notes', { userMessage: 'Unable to load credit notes.' });
    }
  }

  async getSecondaryOrders(context: ResolvedDistributorContext, correlationId?: string): Promise<SecondaryOrder[]> {
    try {
      const escapedId = escapeSoql(context.salesforceAccountId);
      const records = (await this.query<{ Id: string; OrderNumber: string; AccountId: string; Distributor_Account__c?: string; Retailer_Account__c?: string; Retailer_Account__r?: { Name?: string }; Status: string; TotalAmount: number; Grand_Total__c?: number; EffectiveDate: string; Type?: string }>(
        `SELECT Id, OrderNumber, AccountId, Distributor_Account__c, Retailer_Account__c, Retailer_Account__r.Name, Status, TotalAmount, Grand_Total__c, EffectiveDate, Type FROM Order WHERE (AccountId = '${escapedId}' OR Distributor_Account__c = '${escapedId}') AND Type = 'Secondary' ORDER BY CreatedDate DESC LIMIT 50`,
        correlationId,
      )).records;
      const missingIds = [...new Set(records.filter((r) => !r.Retailer_Account__r?.Name && r.Retailer_Account__c).map((r) => r.Retailer_Account__c as string))];
      const nameMap = new Map<string, string>();
      if (missingIds.length > 0) {
        try {
          const idList = missingIds.map((id) => `'${escapeSoql(id)}'`).join(',');
          const accountResult = await this.query<{ Id: string; Name: string }>(`SELECT Id, Name FROM Account WHERE Id IN (${idList})`, correlationId);
          accountResult.records.forEach((a) => nameMap.set(a.Id, a.Name));
        } catch { /* best effort */ }
      }
      return records.map((r) => {
        const fulfillmentStatus = r.Status;
        return {
          orderId: r.Id, orderNumber: r.OrderNumber, distributorId: r.Distributor_Account__c || r.AccountId,
          retailerCustomer: r.Retailer_Account__r?.Name || nameMap.get(r.Retailer_Account__c || '') || r.Retailer_Account__c || 'Unknown Retailer',
          status: r.Status, totalAmount: r.TotalAmount || r.Grand_Total__c || 0,
          fulfillmentStatus, invoiceStatus: '', dispatchStatus: '', orderDate: r.EffectiveDate || '', items: [], type: r.Type,
        };
      });
    } catch { throw new SalesforceError('Failed to fetch secondary orders', { userMessage: 'Unable to load secondary orders.' }); }
  }

  async getSecondaryOrderDetails(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<SecondaryOrderDetail> {
    try {
      const escapedId = escapeSoql(secondaryOrderId);
      const escapedAccountId = escapeSoql(context.salesforceAccountId);
      const result = await this.query<{ Id: string; OrderNumber: string; AccountId: string; Distributor_Account__c?: string; Retailer_Account__c?: string; Retailer_Account__r?: { Name?: string }; Status: string; TotalAmount: number; Grand_Total__c?: number; EffectiveDate: string }>(
        `SELECT Id, OrderNumber, AccountId, Distributor_Account__c, Retailer_Account__c, Retailer_Account__r.Name, Status, TotalAmount, Grand_Total__c, EffectiveDate FROM Order WHERE Id = '${escapedId}' AND (AccountId = '${escapedAccountId}' OR Distributor_Account__c = '${escapedAccountId}') AND Type = 'Secondary' LIMIT 1`,
        correlationId,
      );
      if (result.records.length === 0) {
        throw new SalesforceError('Secondary order not found', { userMessage: 'Unable to load this secondary order.' });
      }
      const r = result.records[0];
      const fulfillmentStatus = r.Status || 'Unknown';
      const isFullyFulfilled = ['Fully Invoiced', 'Fully Fulfilled'].includes(fulfillmentStatus);

      const [orderItems, invoiceIds, dispatchRecords, grnIds, fulfilledMap, sourceAddress] = await Promise.all([
        this.getOrderItems(r.Id, correlationId),
        this.getRelatedIds('Invoice__c', 'Order__c', r.Id, correlationId),
        this.query<{ Id: string; Status__c: string }>(
          `SELECT Id, Status__c FROM Dispatch_Request__c WHERE Order__c = '${escapedId}' ORDER BY CreatedDate DESC LIMIT 20`,
          correlationId,
        ).then((res) => res.records),
        this.getRelatedIds('Goods_Receipt__c', 'Order__c', r.Id, correlationId),
        this.getFulfilledQtyByProduct(r.Id, correlationId),
        this.getShippingAddress(r.AccountId, correlationId),
      ]);
      const dispatchIds = dispatchRecords.map((d) => d.Id);
      const hasPendingDispatch = dispatchRecords.some((d) => d.Status__c !== 'Delivered');

      const retailerId = r.Retailer_Account__c;
      const retailerName = r.Retailer_Account__r?.Name
        || (retailerId ? await this.query<{ Name: string }>(`SELECT Name FROM Account WHERE Id = '${escapeSoql(retailerId)}' LIMIT 1`, correlationId).then((res) => res.records[0]?.Name || 'Unknown Retailer').catch(() => 'Unknown Retailer') : 'Unknown Retailer');
      const destinationAddress = retailerId ? await this.getShippingAddress(retailerId, correlationId) : '';

      const items = orderItems.map((i) => {
        const fulfilledQty = i.fulfilledQuantity;
        const pendingQty = i.remainingQty != null ? i.remainingQty : Math.max(0, i.quantity - fulfilledQty);
        return {
          itemId: i.itemId, productId: i.productId, productName: i.productName,
          orderedQuantity: i.quantity, availableQuantity: 0,
          fulfilledQuantity: fulfilledQty, pendingQuantity: pendingQty,
          unitPrice: i.unitPrice, unitOfMeasure: i.unitOfMeasure,
        };
      });

      const remainingQtys = items
        .filter((i) => i.pendingQuantity > 0)
        .map((i) => ({ productId: i.productId, productName: i.productName, orderedQty: i.orderedQuantity, remainingQty: i.pendingQuantity }));

      const invoiceStatusDisplay = invoiceIds.length === 0 ? 'Not Invoiced' : isFullyFulfilled ? 'Fully Invoiced' : 'Partially Invoiced';
      const dispatchStatusDisplay = dispatchIds.length === 0
        ? 'No Dispatch'
        : hasPendingDispatch ? 'In Transit'
        : 'All Delivered';

      return {
        orderId: r.Id, orderNumber: r.OrderNumber, distributorId: r.Distributor_Account__c || r.AccountId,
        retailerCustomer: retailerName, status: r.Status,
        totalAmount: r.TotalAmount || r.Grand_Total__c || 0,
        fulfillmentStatus, invoiceStatus: invoiceStatusDisplay,
        dispatchStatus: dispatchStatusDisplay, orderDate: r.EffectiveDate,
        items, invoiceIds, dispatchIds, grnIds,
        canCreateInvoice: !isFullyFulfilled && items.some((i) => i.pendingQuantity > 0),
        canUpdateDispatch: hasPendingDispatch,
        hasPendingDispatch,
        sourceAddress, destinationAddress: destinationAddress || retailerName,
        type: 'Secondary', remainingQtys,
      };
    } catch (err) {
      if (err instanceof SalesforceError) throw err;
      throw new SalesforceError('Failed to fetch secondary order details', { userMessage: 'Unable to load secondary order details.' });
    }
  }

  async getInventoryAvailability(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<InventoryAvailability[]> {
    try {
      const detail = await this.getSecondaryOrderDetails(context, secondaryOrderId, correlationId);
      const pendingItems = detail.items.filter((i) => i.pendingQuantity > 0);
      if (pendingItems.length === 0) return [];
      const inventoryMap = await this.getProductInventory(context.salesforceAccountId, pendingItems.map((i) => i.productId), correlationId);
      return pendingItems.map((i) => {
        const inv = inventoryMap.get(i.productId);
        return {
          productId: i.productId, productName: i.productName,
          orderedQuantity: i.pendingQuantity, // pending qty is what we still need to invoice
          availableQuantity: inv ? Math.min(inv.qty, i.pendingQuantity) : 0,
          batchDetails: inv?.batches ?? [],
        };
      });
    } catch (err) {
      if (err instanceof SalesforceError) throw err;
      throw new SalesforceError('Inventory availability check failed', { userMessage: 'Unable to check inventory availability.' });
    }
  }

  async createInvoice(context: ResolvedDistributorContext, orderId: string, payload: InvoicePayload, correlationId?: string): Promise<DMSInvoice> {
    const log = correlationId ? createChildLogger('SalesforceRestClient', correlationId) : logger;
    try {
      const invoiceItems = payload.items.filter((i) => i.quantity > 0);
      if (invoiceItems.length === 0) {
        throw new SalesforceError('No items to invoice', { userMessage: 'No stock available to invoice. Check inventory levels.' });
      }
      const orderItems = await this.getOrderItems(orderId, correlationId);
      const priceMap = new Map(orderItems.map((i) => [i.productId, i.unitPrice]));
      const totalAmount = invoiceItems.reduce((sum, i) => sum + (priceMap.get(i.productId) || 0) * i.quantity, 0);
      const today = new Date().toISOString().split('T')[0];

      // Full_Partial__c is a restricted picklist whose only values are
      // 'Full Invoice' / 'Partial Invoice' — map the payload's Full/Partial onto them.
      const fullPartialValue = /partial/i.test(payload.fullOrPartial) ? 'Partial Invoice' : 'Full Invoice';

      log.info({ orderId, itemCount: invoiceItems.length, totalAmount, fullPartial: fullPartialValue }, 'Creating secondary invoice');

      // 1. Create Invoice__c header
      const invoiceId = await this.create('Invoice__c', {
        Billing_Account__c: context.salesforceAccountId,
        Order__c: orderId,
        Status__c: 'New',
        Total_Amount__c: totalAmount,
        Invoice_Amount__c: totalAmount,
        Invoice_Date__c: today,
        Full_Partial__c: fullPartialValue,
        Type__c: 'Secondary',
      }, correlationId);
      log.info({ invoiceId }, 'Invoice__c created');

      // 2. Create Invoice_Line_Item__c per product (best effort — fields may vary)
      for (const item of invoiceItems) {
        const unitPrice = priceMap.get(item.productId) || 0;
        try {
          await this.create('Invoice_Line_Item__c', {
            Invoice_Custom__c: invoiceId,
            Product__c: item.productId,
            Quantity__c: item.quantity,
            Unit_Price__c: unitPrice,
            Total_Price__c: unitPrice * item.quantity,
            Total_Amount_with_Tax__c: unitPrice * item.quantity,
          }, correlationId);
        } catch (lineErr) {
          log.warn({ err: lineErr, productId: item.productId }, 'Invoice line item creation failed — invoice header intact');
        }
      }

      // 3. Deduct inventory from batches (FIFO, best effort)
      try {
        const inventoryMap = await this.getProductInventory(context.salesforceAccountId, invoiceItems.map((i) => i.productId), correlationId);
        for (const item of invoiceItems) {
          let remaining = item.quantity;
          const inv = inventoryMap.get(item.productId);
          if (!inv) continue;
          for (const batch of inv.batches) {
            if (remaining <= 0) break;
            const deduct = Math.min(remaining, batch.quantity);
            try {
              await this.update('Inventory_Batch__c', batch.batchId, { Quantity__c: batch.quantity - deduct }, correlationId);
            } catch {
              try {
                await this.update('Inventory_Batch__c', batch.batchId, { Available_Quantity__c: batch.quantity - deduct }, correlationId);
              } catch { log.warn({ batchId: batch.batchId }, 'Could not deduct inventory batch'); }
            }
            remaining -= deduct;
          }
        }
      } catch (invErr) {
        log.warn({ err: invErr }, 'Inventory deduction failed — invoice still created');
      }

      // 4. Create Dispatch_Request__c with proper addresses
      let dispatchId: string | undefined;
      try {
        const orderRec = await this.query<{ AccountId: string; Retailer_Account__c?: string }>(
          `SELECT AccountId, Retailer_Account__c FROM Order WHERE Id = '${escapeSoql(orderId)}' LIMIT 1`, correlationId,
        );
        const distributorId = orderRec.records[0]?.AccountId || context.salesforceAccountId;
        const retailerId = orderRec.records[0]?.Retailer_Account__c;
        const [sourceAddr, destAddr] = await Promise.all([
          this.getShippingAddress(distributorId, correlationId),
          retailerId ? this.getShippingAddress(retailerId, correlationId) : Promise.resolve(''),
        ]);
        dispatchId = await this.create('Dispatch_Request__c', {
          Order__c: orderId,
          Invoice_Custom__c: invoiceId,
          Status__c: 'Draft',
          Dispatch_Request_Name__c: `DSP-${invoiceId.slice(-6).toUpperCase()}`,
          Source_Address__c: sourceAddr || context.salesforceAccountId,
          Destination_Address__c: destAddr || retailerId || '',
          Start_Date__c: today,
        }, correlationId);
        log.info({ dispatchId }, 'Dispatch_Request__c created');
      } catch (dispatchErr) {
        log.warn({ err: dispatchErr }, 'Dispatch creation failed — invoice still created');
      }

      // 5. Update Order Sub_Status__c
      try {
        const fulfilledMap = await this.getFulfilledQtyByProduct(orderId, correlationId);
        invoiceItems.forEach((i) => fulfilledMap.set(i.productId, (fulfilledMap.get(i.productId) || 0) + i.quantity));
        const allFulfilled = orderItems.every((oi) => (fulfilledMap.get(oi.productId) || 0) >= oi.quantity);
        const newStatus = allFulfilled ? 'Fully Invoiced' : 'Partially Invoiced';
        await this.update('Order', orderId, { Sub_Status__c: newStatus }, correlationId);
        log.info({ orderId, newStatus }, 'Order Sub_Status__c updated');
      } catch (statusErr) {
        log.warn({ err: statusErr }, 'Could not update Order Sub_Status__c');
      }

      return {
        invoiceId, invoiceNumber: `INV-${invoiceId.slice(-6).toUpperCase()}`,
        accountId: context.salesforceAccountId, orderId, status: 'Generated',
        totalAmount, invoiceDate: today, paymentStatus: 'Unpaid',
        type: 'Secondary', fullPartial: fullPartialValue,
      };
    } catch (err) {
      if (err instanceof SalesforceError) throw err;
      throw new SalesforceError('Invoice creation failed', { userMessage: 'Unable to create invoice. Please try again.' });
    }
  }

  async getInvoiceDetails(context: ResolvedDistributorContext, invoiceId: string, correlationId?: string): Promise<DMSInvoice> {
    try {
      const r = await this.getRecord<{ Id: string; Name: string; Billing_Account__c: string; Order__c?: string; Status__c: string; Total_Amount__c?: number; Invoice_Date__c?: string; Payment_Status__c?: string; Full_Partial__c?: string; Type__c?: string }>('Invoice__c', invoiceId, undefined, correlationId);
      return {
        invoiceId: r.Id, invoiceNumber: r.Name, accountId: r.Billing_Account__c,
        orderId: r.Order__c, status: r.Status__c, totalAmount: r.Total_Amount__c || 0,
        invoiceDate: r.Invoice_Date__c, paymentStatus: r.Payment_Status__c,
        type: r.Type__c, fullPartial: r.Full_Partial__c,
      };
    } catch (err) {
      throw new SalesforceError('Invoice details fetch failed', { userMessage: 'Unable to load invoice details.' });
    }
  }

  async getDispatchRequests(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<DispatchRequest[]> {
    try {
      const result = await this.query<{ Id: string; Dispatch_Request_Name__c?: string; Order__c?: string; Status__c: string; Invoice_Custom__c?: string; Start_Date__c?: string; End_Date__c?: string; Source_Address__c?: string; Destination_Address__c?: string }>(
        `SELECT Id, Dispatch_Request_Name__c, Order__c, Status__c, Invoice_Custom__c, Start_Date__c, End_Date__c, Source_Address__c, Destination_Address__c FROM Dispatch_Request__c WHERE Order__c = '${escapeSoql(secondaryOrderId)}' ORDER BY CreatedDate DESC LIMIT 20`,
        correlationId,
      );
      return result.records.map((r) => ({
        dispatchId: r.Id, dispatchName: r.Dispatch_Request_Name__c || r.Id,
        orderId: r.Order__c, status: r.Status__c, invoiceId: r.Invoice_Custom__c,
        startDate: r.Start_Date__c, endDate: r.End_Date__c,
        sourceAddress: r.Source_Address__c, destinationAddress: r.Destination_Address__c,
      }));
    } catch (err) {
      if (err instanceof SalesforceError) throw err;
      throw new SalesforceError('Failed to fetch dispatch requests', { userMessage: 'Unable to load dispatch information.' });
    }
  }

  async updateDispatchStatus(context: ResolvedDistributorContext, dispatchRequestId: string, newStatus: string, correlationId?: string): Promise<DispatchRequest> {
    const log = correlationId ? createChildLogger('SalesforceRestClient', correlationId) : logger;
    try {
      await this.update('Dispatch_Request__c', dispatchRequestId, { Status__c: newStatus }, correlationId);
      log.info({ dispatchRequestId, newStatus }, 'Dispatch status updated');

      const r = await this.getRecord<{ Id: string; Dispatch_Request_Name__c?: string; Order__c?: string; Status__c: string; Invoice_Custom__c?: string; Start_Date__c?: string; End_Date__c?: string; Source_Address__c?: string; Destination_Address__c?: string }>('Dispatch_Request__c', dispatchRequestId, undefined, correlationId);

      if (newStatus === 'Delivered') {
        // Mark invoice as Approved on delivery
        if (r.Invoice_Custom__c) {
          try {
            await this.update('Invoice__c', r.Invoice_Custom__c, { Status__c: 'Approved' }, correlationId);
          } catch (invErr) { log.warn({ err: invErr }, 'Could not update Invoice status to Approved on delivery'); }
        }
        // Update Order Status → Delivered
        if (r.Order__c) {
          try {
            await this.update('Order', r.Order__c, { Status: 'Delivered' }, correlationId);
            log.info({ orderId: r.Order__c }, 'Order Status updated to Delivered');
          } catch (orderErr) { log.warn({ err: orderErr }, 'Could not update Order Status to Delivered'); }
        }
        // GRN is created by the user via the GRN entry form — no auto-creation here
      }

      return {
        dispatchId: r.Id, dispatchName: r.Dispatch_Request_Name__c || r.Id,
        orderId: r.Order__c, status: r.Status__c, invoiceId: r.Invoice_Custom__c,
        startDate: r.Start_Date__c, endDate: r.End_Date__c,
        sourceAddress: r.Source_Address__c, destinationAddress: r.Destination_Address__c,
      };
    } catch (err) {
      if (err instanceof SalesforceError) throw err;
      throw new SalesforceError('Dispatch status update failed', { userMessage: 'Unable to update dispatch status.' });
    }
  }

  async getSecondaryOrderGRN(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<SecondaryOrderGRN> {
    try {
      const result = await this.query<{ Id: string; Name: string; GRN_Status__c?: string; Status__c?: string }>(
        `SELECT Id, Name, GRN_Status__c, Status__c FROM Goods_Receipt__c WHERE Order__c = '${escapeSoql(secondaryOrderId)}' ORDER BY CreatedDate DESC LIMIT 1`,
        correlationId,
      );
      if (result.records.length === 0) {
        throw new SalesforceError('No GRN found for this secondary order', { userMessage: 'No GRN found for this secondary order.' });
      }
      const r = result.records[0];
      return { grnId: r.Id, grnNumber: r.Name, secondaryOrderId, status: r.GRN_Status__c || r.Status__c || 'New', items: [] };
    } catch (err) {
      if (err instanceof SalesforceError) throw err;
      throw new SalesforceError('Secondary order GRN fetch failed', { userMessage: 'Unable to load GRN details.' });
    }
  }

  async getGoodsReceiptLines(_context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<Array<{ lineId: string; grnId: string; grnNumber: string; productId: string; productName: string; orderedQuantity: number; receivedQuantity: number; lostQuantity: number; damagedQuantity: number; status?: string }>> {
    try {
      const result = await this.query<{
        Id: string;
        Goods_Receipt_Note__c: string;
        Goods_Receipt_Note__r?: { Name?: string };
        Product__c?: string;
        Product__r?: { Name?: string };
        Quantity_Ordered__c?: number;
        Quantity_Received__c?: number;
        Short_Quantity__c?: number;
        Damage_Quantity__c?: number;
        GRN_Line_Status__c?: string;
        Status__c?: string;
      }>(
        `SELECT Id, Goods_Receipt_Note__c, Goods_Receipt_Note__r.Name, Product__c, Product__r.Name, Quantity_Ordered__c, Quantity_Received__c, Short_Quantity__c, Damage_Quantity__c, GRN_Line_Status__c, Status__c FROM GRN_Line__c WHERE Goods_Receipt_Note__r.Order__c = '${escapeSoql(secondaryOrderId)}' ORDER BY Product__c, CreatedDate ASC`,
        correlationId,
      );
      return result.records
        .filter((r) => r.Goods_Receipt_Note__c && r.Product__c && (r.Quantity_Ordered__c || 0) > 0)
        .map((r) => ({
          lineId: r.Id,
          grnId: r.Goods_Receipt_Note__c,
          grnNumber: r.Goods_Receipt_Note__r?.Name || r.Goods_Receipt_Note__c,
          productId: r.Product__c as string,
          productName: r.Product__r?.Name || r.Product__c as string,
          orderedQuantity: r.Quantity_Ordered__c || 0,
          receivedQuantity: r.Quantity_Received__c || 0,
          lostQuantity: r.Short_Quantity__c || 0,
          damagedQuantity: r.Damage_Quantity__c || 0,
          status: r.GRN_Line_Status__c || r.Status__c,
        }));
    } catch (err) {
      if (err instanceof SalesforceError) throw err;
      throw new SalesforceError('Goods receipt lines fetch failed', { userMessage: 'Unable to load GRN line items.' });
    }
  }

  async updateGoodsReceiptLines(
    context: ResolvedDistributorContext,
    secondaryOrderId: string,
    items: Array<{ lineId: string; receivedQty: number; lostQty: number; damagedQty: number }>,
    correlationId?: string,
  ): Promise<{ grnId: string; grnNumber: string }> {
    const lines = await this.getGoodsReceiptLines(context, secondaryOrderId, correlationId);
    const applied = await this.applyGoodsReceipt(lines, items, correlationId);
    return { grnId: applied.grnId, grnNumber: applied.grnNumber };
  }

  async getInvoiceLineItems(_context: ResolvedDistributorContext, invoiceId: string, correlationId?: string): Promise<Array<{ productId: string; productName: string; quantity: number }>> {
    try {
      const result = await this.query<{ Id: string; Product__c?: string; Product__r?: { Name?: string }; Quantity__c?: number }>(
        `SELECT Id, Product__c, Product__r.Name, Quantity__c FROM Invoice_Line_Item__c WHERE Invoice_Custom__c = '${escapeSoql(invoiceId)}' AND Product__c != null ORDER BY CreatedDate ASC`,
        correlationId,
      );
      return result.records
        .filter((r) => r.Product__c && (r.Quantity__c || 0) > 0)
        .map((r) => ({
          productId: r.Product__c as string,
          productName: r.Product__r?.Name || r.Product__c as string,
          quantity: r.Quantity__c || 0,
        }));
    } catch (err) {
      if (err instanceof SalesforceError) throw err;
      throw new SalesforceError('Invoice line items fetch failed', { userMessage: 'Unable to load invoice details.' });
    }
  }

  // Record GRN receipt for a delivered dispatch, keyed by product. The Goods_Receipt__c +
  // GRN_Line__c rows are auto-created by the "Create_GRN_on_Dispatch_Request" flow when the
  // dispatch is marked Delivered — this method locates those lines and writes the received
  // quantities onto them (it never creates GRN records).
  async createGRNFromDelivery(
    context: ResolvedDistributorContext,
    orderId: string,
    invoiceId: string,
    items: Array<{ productId: string; receivedQty: number; lostQty: number; damagedQty: number }>,
    correlationId?: string,
  ): Promise<{ grnId: string; grnNumber: string }> {
    const log = correlationId ? createChildLogger('SalesforceRestClient', correlationId) : logger;
    try {
      const lines = await this.getGoodsReceiptLines(context, orderId, correlationId);
      if (lines.length === 0) {
        throw new SalesforceError('No GRN lines found for delivery', {
          userMessage: 'The Goods Receipt Note for this delivery has not been generated yet. It is created automatically once the dispatch is marked Delivered — please try again shortly.',
        });
      }

      const lineByProduct = new Map(lines.map((line) => [line.productId, line]));
      const updates: GoodsReceiptUpdate[] = [];
      for (const item of items) {
        const line = lineByProduct.get(item.productId);
        if (!line) continue;
        updates.push({ lineId: line.lineId, receivedQty: item.receivedQty, lostQty: item.lostQty, damagedQty: item.damagedQty });
      }
      if (updates.length === 0) {
        throw new SalesforceError('No matching GRN lines', { userMessage: 'None of the submitted products matched the generated GRN lines for this delivery.' });
      }

      const applied = await this.applyGoodsReceipt(lines, updates, correlationId);
      log.info({ grnId: applied.grnId, orderId, invoiceId, itemCount: updates.length }, 'GRN receipt recorded from delivery user input');
      return { grnId: applied.grnId, grnNumber: applied.grnNumber };
    } catch (err) {
      if (err instanceof SalesforceError) throw err;
      throw new SalesforceError('GRN update failed', { userMessage: 'Unable to record GRN. Please try again.' });
    }
  }

  async getARSConfig(_context: ResolvedDistributorContext, correlationId?: string): Promise<ArsConfig> {
    const result = await this.query<{ MasterLabel: string; Default_Order_Status__c?: string; Include_In_Transit__c?: boolean; Enable_Debug_Mode__c?: boolean; SystemModstamp?: string }>(
      'SELECT MasterLabel, Default_Order_Status__c, Include_In_Transit__c, Enable_Debug_Mode__c, SystemModstamp FROM Replenishment_Settings__mdt LIMIT 1',
      correlationId,
    );
    const row = result.records[0];
    return {
      autoReplenishmentEnabled: Boolean(row?.Include_In_Transit__c),
      activeProducts: {
        productId: '',
        productName: row?.MasterLabel || 'Replenishment Settings',
        currentStock: 0,
        minThreshold: 0,
        maxThreshold: 0,
        reorderPoint: 0,
        reorderQuantity: 0,
        isActive: Boolean(row),
      },
      minThreshold: 0,
      maxThreshold: 0,
      replenishmentFrequency: row?.Default_Order_Status__c || 'Read-only metadata',
      lastModifiedBy: 'Salesforce metadata',
      lastModifiedDate: row?.SystemModstamp || '',
    };
  }
  async updateARSStatus(context: ResolvedDistributorContext, active: boolean, correlationId?: string): Promise<ArsConfig> {
    try {
      const escapedId = escapeSoql(context.salesforceAccountId);
      const batches = await this.query<{ Id: string; Status__c: string }>(
        `SELECT Id, Status__c FROM Inventory_Batch__c WHERE Distributor__c = '${escapedId}'`,
        correlationId,
      );
      const newStatus = active ? 'Active' : 'Inactive';
      for (const batch of batches.records) {
        if (batch.Status__c !== newStatus) {
          await this.update('Inventory_Batch__c', batch.Id, { Status__c: newStatus }, correlationId);
        }
      }
      return this.getARSConfig(context, correlationId);
    } catch (err) {
      throw new SalesforceError('Failed to update ARS status', { userMessage: 'Unable to update ARS status. Please try again.' });
    }
  }
  async getBatchWiseStockPolicies(context: ResolvedDistributorContext): Promise<BatchStockPolicy[]> {
    try {
      const escapedId = escapeSoql(context.salesforceAccountId);
      const result = await this.query<{ Id: string; Name: string; Product__c: string; Product__r?: { Name?: string }; Expiry_Date__c: string; Status__c: string }>(`SELECT Id, Name, Product__c, Product__r.Name, Expiry_Date__c, Status__c FROM Inventory_Batch__c WHERE Distributor__c = '${escapedId}' LIMIT 50`);
      return result.records.map((r) => ({ batchId: r.Id, batchNumber: r.Name, productId: r.Product__c, productName: r.Product__r?.Name || r.Product__c, availableStock: 0, minStock: 0, maxStock: 0, expiryDate: r.Expiry_Date__c, replenishmentStatus: r.Status__c || 'Read-only', lastUpdated: '' }));
    } catch { throw new SalesforceError('Failed to fetch batch stock policies.'); }
  }
  async getARSTriggeredOrders(): Promise<ArsTriggeredOrder[]> { return []; }

  async applyARSPolicyChanges(
    accountId: string,
    changes: Array<{ productId: string; newMin: number; newMax: number }>,
    correlationId?: string,
  ): Promise<void> {
    const escapedAccountId = escapeSoql(accountId);
    for (const change of changes) {
      const escapedProductId = escapeSoql(change.productId || '');
      try {
        const batches = await this.query<{ Id: string }>(
          `SELECT Id FROM Inventory_Batch__c WHERE Distributor__c = '${escapedAccountId}' AND Product__c = '${escapedProductId}' LIMIT 5`,
          correlationId,
        );
        for (const batch of batches.records) {
          await this.update('Inventory_Batch__c', batch.Id, { Minimum_Quantity__c: change.newMin, Maximum_Quantity__c: change.newMax }, correlationId);
        }
      } catch (batchErr) {
        logger.warn({ err: batchErr, productId: change.productId }, 'Could not update Inventory_Batch__c, trying Inventory_Policy__c');
        try {
          const policyQuery = await this.query<{ Id: string }>(
            `SELECT Id FROM Inventory_Policy__c WHERE Distributor__c = '${escapedAccountId}' AND Product__c = '${escapedProductId}' LIMIT 1`,
            correlationId,
          );
          if (policyQuery.records.length > 0) {
            await this.update('Inventory_Policy__c', policyQuery.records[0].Id, { Minimum_Quantity__c: change.newMin, Maximum_Quantity__c: change.newMax }, correlationId);
          }
        } catch { /* Inventory_Policy__c may not exist */ }
      }
    }
  }

  async getBusinessInsightsEnhanced(): Promise<AIBusinessInsight[]> { throw new SalesforceError('AI insights not available via REST API (BLK-009).'); }
  async getStockThresholdRecommendations(): Promise<AIStockRecommendation[]> { throw new SalesforceError('Stock threshold AI not available via REST API (BLK-009).'); }
  async getUpsellRecommendations(): Promise<AIUpsellRecommendation[]> { throw new SalesforceError('Upsell recommendations not available via REST API (BLK-009).'); }
  async applyStockThresholdRecommendation(): Promise<AIStockRecommendation> { throw new SalesforceError('AI recommendation application not available via REST API (BLK-009).'); }

  // -- Secondary order private helpers --

  private async getShippingAddress(accountId: string, correlationId?: string): Promise<string> {
    try {
      const result = await this.query<{ ShippingStreet?: string; ShippingCity?: string; ShippingState?: string; ShippingPostalCode?: string }>(
        `SELECT ShippingStreet, ShippingCity, ShippingState, ShippingPostalCode FROM Account WHERE Id = '${escapeSoql(accountId)}' LIMIT 1`,
        correlationId,
      );
      const r = result.records[0];
      if (!r) return '';
      return [r.ShippingStreet, r.ShippingCity, r.ShippingState, r.ShippingPostalCode].filter(Boolean).join(', ');
    } catch { return ''; }
  }

  private async getProductInventory(
    distributorId: string,
    productIds: string[],
    correlationId?: string,
  ): Promise<Map<string, { qty: number; batches: Array<{ batchId: string; quantity: number; expiryDate?: string }> }>> {
    const resultMap = new Map<string, { qty: number; batches: Array<{ batchId: string; quantity: number; expiryDate?: string }> }>();
    if (productIds.length === 0) return resultMap;
    const idList = productIds.map((id) => `'${escapeSoql(id)}'`).join(',');
    const dEsc = escapeSoql(distributorId);

    interface InvRec { Id: string; Product__c: string; Quantity_Available__c?: number; Total_Quantity__c?: number; Expiry_Date__c?: string }
    let records: InvRec[] = [];
    let qtyField: 'Quantity_Available__c' | 'Total_Quantity__c' = 'Quantity_Available__c';

    try {
      const r = await this.query<InvRec>(
        `SELECT Id, Product__c, Quantity_Available__c, Expiry_Date__c FROM Inventory__c WHERE Account__c = '${dEsc}' AND Product__c IN (${idList})`,
        correlationId,
      );
      records = r.records;
    } catch (firstErr) {
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      logger.warn({ err: firstErr }, 'Could not query Inventory__c with Quantity_Available__c');
      if (msg.includes('INVALID_FIELD') || msg.includes('No such column')) {
        try {
          const r2 = await this.query<InvRec>(
            `SELECT Id, Product__c, Total_Quantity__c, Expiry_Date__c FROM Inventory__c WHERE Account__c = '${dEsc}' AND Product__c IN (${idList})`,
            correlationId,
          );
          records = r2.records;
          qtyField = 'Total_Quantity__c';
        } catch { logger.warn('Could not query Inventory__c — availability will show as zero'); }
      }
    }

    for (const inv of records) {
      const qty = (inv[qtyField] as number | undefined) || 0;
      const existing = resultMap.get(inv.Product__c) ?? { qty: 0, batches: [] };
      existing.qty += qty;
      existing.batches.push({ batchId: inv.Id, quantity: qty, expiryDate: inv.Expiry_Date__c });
      resultMap.set(inv.Product__c, existing);
    }
    return resultMap;
  }

  private async getFulfilledQtyByProduct(orderId: string, correlationId?: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    try {
      const result = await this.query<{ Product__c: string; totalQty: number }>(
        `SELECT Product__c, SUM(Quantity__c) totalQty FROM Invoice_Line_Item__c WHERE Invoice_Custom__r.Order__c = '${escapeSoql(orderId)}' GROUP BY Product__c`,
        correlationId,
      );
      result.records.forEach((r) => map.set(r.Product__c, r.totalQty || 0));
    } catch { /* Invoice_Line_Item__c fields uncertain — treat fulfilled as 0 */ }
    return map;
  }
}

function normalizeApiVersion(version: string): string {
  const withoutPrefix = version.replace(/^v/i, '');
  return `v${withoutPrefix.includes('.') ? withoutPrefix : `${withoutPrefix}.0`}`;
}

function escapeSoql(value: string): string {
  return value.replace(/'/g, "\\'");
}
