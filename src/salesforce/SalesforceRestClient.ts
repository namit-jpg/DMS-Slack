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

const logger = createChildLogger('SalesforceRestClient');

export class SalesforceRestClient implements ISalesforceClient {
  private auth: SalesforceAuth;
  private apiVersion = 'v62.0';
  private cliToken: { accessToken: string; instanceUrl: string } | null = null;

  constructor(auth: SalesforceAuth) {
    this.auth = auth;
  }

  setCliToken(token: { accessToken: string; instanceUrl: string }): void {
    this.cliToken = token;
    this.apiVersion = normalizeApiVersion(process.env.SALESFORCE_API_VERSION || '66.0');
  }

  private async getToken(): Promise<{ accessToken: string; instanceUrl: string }> {
    if (this.cliToken) return this.cliToken;
    return this.auth.getToken();
  }

  isMock(): boolean { return false; }

  async query<T = SalesforceRecord>(soql: string, correlationId?: string): Promise<SalesforceQueryResult<T>> {
    const log = correlationId ? createChildLogger('SalesforceRestClient', correlationId) : logger;
    const token = await this.getToken();
    const encodedQuery = encodeURIComponent(soql);
    const url = `${token.instanceUrl}/services/data/${this.apiVersion}/query/?q=${encodedQuery}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

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
      const response = await fetch(
        `${token.instanceUrl}${nextUrl}`,
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
          },
        },
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

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fields),
    });

    if (!response.ok) {
      const body = await response.text();
      log.error({ status: response.status, body }, 'Salesforce create failed');
      throw new SalesforceError(`Create ${objectName} failed: ${response.statusText}`, {
        userMessage: `Unable to create the ${objectName} record.`,
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

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fields),
    });

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

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });

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

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

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

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new SalesforceError(`Get ${objectName}/${id} failed`, {
        userMessage: 'Unable to retrieve the record.',
      });
    }

    return (await response.json()) as T;
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
      UnitPrice: number;
      TotalPrice: number;
      Unit_Of_Measure__c?: string;
    }>(
      `SELECT Id, Product2Id, Product2.Name, Product2.ProductCode, Quantity, UnitPrice, TotalPrice, Unit_Of_Measure__c FROM OrderItem WHERE OrderId = '${escapedOrderId}' ORDER BY CreatedDate ASC`,
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
      fulfilledQuantity: 0,
      expectedQuantity: r.Quantity || 0,
      deliveryStatus: 'Pending',
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
        minOrderQtyPrimary: r.Product2.Minimum_Order_Quantity_Primary__c || 0,
        minOrderQtySecondary: r.Product2.Minimum_Order_Quantity_Secondary__c || 0,
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
        Scheme_Code__c: quote.appliedSchemes.join(', ').slice(0, 255),
        Credit_Applied__c: quote.creditApplied || 0,
        Tax_Amount__c: quote.taxAmount,
        Approval_Status__c: 'None',
        Order_Products__c: quote.lineItems
          .map((li) => `${li.productCode || li.productId}: ${li.quantity} ${li.unitOfMeasure || ''}`.trim())
          .join('\n'),
        Description: `Created from Slack DMSFA for ${context.accountName} (${context.slackEmail})`,
      };
      orderId = await this.create('Order', recordData, correlationId);
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
      await this.update('Order', orderId, { Status: 'Order Placed' }, correlationId);
      const created = await this.getRecord<{
        Id: string;
        OrderNumber?: string;
      }>('Order', orderId, ['Id', 'OrderNumber'], correlationId);
      return {
        orderId, orderNumber: created.OrderNumber || orderId,
        distributorId: context.salesforceAccountId, status: 'Order Placed',
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
      const escapedsfAccountId = context.salesforceAccountId.replace(/'/g, "\\'");
      const escapedOrderId = orderId.replace(/'/g, "\\'");
      const soql = `SELECT Id, OrderNumber, AccountId, Status, Type, EffectiveDate, TotalAmount, Grand_Total__c, Discount_Amount__c, Credit_Applied__c, Tax_Amount__c, Approval_Status__c, Order_Products__c, Description FROM Order WHERE Id = '${escapedOrderId}' AND AccountId = '${escapedsfAccountId}' AND Type = 'Primary' LIMIT 1`;
      const result = await this.query<{ Id: string; OrderNumber: string; AccountId: string; Status: string; EffectiveDate: string; TotalAmount: number; Grand_Total__c: number; Discount_Amount__c: number; Credit_Applied__c: number; Tax_Amount__c: number; Approval_Status__c: string; Order_Products__c?: string }>(soql, correlationId);
      if (result.records.length === 0) throw new SalesforceError('Order not found or access denied');
      const r = result.records[0];
      const items = await this.getOrderItems(r.Id, correlationId);
      const grnIds = await this.getRelatedIds('GRN__c', 'Order__c', r.Id, correlationId);
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

  async createOrUpdateGRN(context: ResolvedDistributorContext, _orderId: string, grnData: GRNPayload, correlationId?: string): Promise<GRNResult> {
    try {
      const order = await this.query<{ Id: string; Type: string }>(
        `SELECT Id, Type FROM Order WHERE Id = '${escapeSoql(_orderId)}' AND AccountId = '${escapeSoql(context.salesforceAccountId)}' LIMIT 1`,
        correlationId,
      );
      if (order.records.length === 0) {
        throw new SalesforceError('Order not found for GRN', {
          userMessage: 'Unable to process GRN because the order was not found for your distributor account.',
        });
      }
      const grnIds: string[] = [];
      for (const item of grnData.items) {
        const status = item.receivedQuantity >= item.expectedQuantity && item.damagedQuantity === 0 && item.missingQuantity === 0
          ? 'Full Order Received'
          : 'Partial Order Received';
        const condition = item.damagedQuantity > 0
          ? 'Damaged'
          : item.missingQuantity > 0
            ? 'Short Supply'
            : 'Other';
        const grnId = await this.create('GRN__c', {
          Order__c: _orderId,
          Product__c: item.productId,
          Order_Type__c: order.records[0].Type || 'Primary',
          Quantity__c: item.expectedQuantity,
          Good_Quantity__c: item.receivedQuantity,
          Defective_product_Quantity__c: item.damagedQuantity + item.missingQuantity,
          Product_Condition__c: condition,
          Status__c: status,
        }, correlationId);
        grnIds.push(grnId);
      }
      return {
        grnId: grnIds[0] || '', grnNumber: grnIds.length === 1 ? `GRN-${grnIds[0].slice(-4)}` : `${grnIds.length} GRN rows`, orderId: _orderId,
        status: 'Processed', items: grnData.items.map((i) => ({
          productId: i.productId, receivedQuantity: i.receivedQuantity,
          damagedQuantity: i.damagedQuantity, missingQuantity: i.missingQuantity,
        })),
        notes: grnData.notes,
      };
    } catch (err) {
      throw new SalesforceError('GRN creation failed', { userMessage: 'Unable to process GRN.', cause: err instanceof Error ? err : undefined });
    }
  }

  async getGRNDetails(_context: ResolvedDistributorContext, grnId: string, correlationId?: string): Promise<GRNResult> {
    try {
      const r = await this.getRecord<{ Id: string; Name: string; Status__c: string; Order__c: string; Amount__c: number; Notes__c: string }>('GRN__c', grnId, undefined, correlationId);
      return {
        grnId: r.Id, grnNumber: r.Name, orderId: r.Order__c || '',
        status: r.Status__c, items: [], notes: r.Notes__c || '',
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
      const escapedsfAccountId = context.salesforceAccountId.replace(/'/g, "\\'");
      const escapedId = returnOrderId.replace(/'/g, "\\'");
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
      const soql = `SELECT Id, Approval_Status__c FROM ${objectName} WHERE Id = '${recordId.replace(/'/g, "\\'")}' LIMIT 1`;
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
      return (await this.query<{ Id: string; OrderNumber: string; AccountId: string; Retailer_Account__c?: string; Status: string; TotalAmount: number; Grand_Total__c?: number; EffectiveDate: string; Type?: string }>(`SELECT Id, OrderNumber, AccountId, Retailer_Account__c, Status, TotalAmount, Grand_Total__c, EffectiveDate, Type FROM Order WHERE AccountId = '${escapedId}' AND Type = 'Secondary' ORDER BY CreatedDate DESC LIMIT 50`, correlationId)).records.map((r) => ({
        orderId: r.Id, orderNumber: r.OrderNumber, distributorId: r.AccountId, retailerCustomer: r.Retailer_Account__c || '', status: r.Status, totalAmount: r.TotalAmount || r.Grand_Total__c || 0,
        fulfillmentStatus: r.Status, invoiceStatus: '', dispatchStatus: '', orderDate: r.EffectiveDate || '', items: [], type: r.Type,
      }));
    } catch { throw new SalesforceError('Failed to fetch secondary orders', { userMessage: 'Unable to load secondary orders.' }); }
  }

  async getSecondaryOrderDetails(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<SecondaryOrderDetail> {
    const escapedId = escapeSoql(secondaryOrderId);
    const escapedAccountId = escapeSoql(context.salesforceAccountId);
    const result = await this.query<{ Id: string; OrderNumber: string; AccountId: string; Retailer_Account__c?: string; Status: string; TotalAmount: number; Grand_Total__c?: number; EffectiveDate: string }>(
      `SELECT Id, OrderNumber, AccountId, Retailer_Account__c, Status, TotalAmount, Grand_Total__c, EffectiveDate FROM Order WHERE Id = '${escapedId}' AND AccountId = '${escapedAccountId}' AND Type = 'Secondary' LIMIT 1`,
      correlationId,
    );
    if (result.records.length === 0) {
      throw new SalesforceError('Secondary order not found', { userMessage: 'Unable to load this secondary order.' });
    }
    const r = result.records[0];
    const orderItems = await this.getOrderItems(r.Id, correlationId);
    const items = orderItems.map((i) => ({
      itemId: i.itemId,
      productId: i.productId,
      productName: i.productName,
      orderedQuantity: i.quantity,
      availableQuantity: 0,
      fulfilledQuantity: 0,
      pendingQuantity: i.quantity,
      unitPrice: i.unitPrice,
      unitOfMeasure: i.unitOfMeasure,
    }));
    const invoiceIds = await this.getRelatedIds('Invoice__c', 'Order__c', r.Id, correlationId);
    const dispatchIds = await this.getRelatedIds('Dispatch_Request__c', 'Order__c', r.Id, correlationId);
    const grnIds = await this.getRelatedIds('GRN__c', 'Order__c', r.Id, correlationId);
    return {
      orderId: r.Id,
      orderNumber: r.OrderNumber,
      distributorId: r.AccountId,
      retailerCustomer: r.Retailer_Account__c || '',
      status: r.Status,
      totalAmount: r.TotalAmount || r.Grand_Total__c || 0,
      fulfillmentStatus: r.Status,
      invoiceStatus: invoiceIds.length > 0 ? 'Invoiced' : 'Not Invoiced',
      dispatchStatus: dispatchIds.length > 0 ? 'Dispatch Created' : 'No Dispatch',
      orderDate: r.EffectiveDate,
      items,
      invoiceIds,
      dispatchIds,
      grnIds,
      canCreateInvoice: false,
      canUpdateDispatch: false,
      sourceAddress: '',
      destinationAddress: '',
      type: 'Secondary',
    };
  }

  async getInventoryAvailability(_context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<InventoryAvailability[]> {
    const detail = await this.getSecondaryOrderDetails(_context, secondaryOrderId, correlationId);
    return detail.items.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      orderedQuantity: i.orderedQuantity,
      availableQuantity: i.availableQuantity,
      batchDetails: [],
    }));
  }
  async createInvoice(context: ResolvedDistributorContext, orderId: string, payload: InvoicePayload): Promise<DMSInvoice> {
    try {
      const record: Record<string, unknown> = { Billing_Account__c: context.salesforceAccountId, Status__c: 'Generated', Total_Amount__c: 0, Type__c: payload.fullOrPartial };
      const id = await this.create('Invoice__c', record);
      return { invoiceId: id, invoiceNumber: `INV-${id.slice(-4)}`, accountId: context.salesforceAccountId, status: 'Generated', totalAmount: 0, paymentStatus: 'Unpaid', type: payload.fullOrPartial, fullPartial: payload.fullOrPartial };
    } catch { throw new SalesforceError('Invoice creation failed', { userMessage: 'Unable to create invoice.' }); }
  }
  async getInvoiceDetails(): Promise<DMSInvoice> { throw new SalesforceError('Invoice details not available.'); }
  async getDispatchRequests(): Promise<DispatchRequest[]> { throw new SalesforceError('Dispatch request retrieval not available (BLK-004).'); }
  async updateDispatchStatus(): Promise<DispatchRequest> { throw new SalesforceError('Dispatch status update not available (BLK-004).'); }
  async getSecondaryOrderGRN(): Promise<SecondaryOrderGRN> { throw new SalesforceError('Secondary order GRN not available (BLK-004).'); }

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
  async updateARSStatus(): Promise<ArsConfig> { throw new SalesforceError('ARS settings are read-only from Slack.', { userMessage: 'ARS settings are available as a read-only dashboard. Updates require Salesforce metadata/API support.' }); }
  async getBatchWiseStockPolicies(context: ResolvedDistributorContext): Promise<BatchStockPolicy[]> {
    try {
      const escapedId = context.salesforceAccountId.replace(/'/g, "\\'");
      const result = await this.query<{ Id: string; Name: string; Product__c: string; Product__r?: { Name?: string }; Expiry_Date__c: string; Status__c: string }>(`SELECT Id, Name, Product__c, Product__r.Name, Expiry_Date__c, Status__c FROM Inventory_Batch__c WHERE Distributor__c = '${escapedId}' LIMIT 50`);
      return result.records.map((r) => ({ batchId: r.Id, batchNumber: r.Name, productId: r.Product__c, productName: r.Product__r?.Name || r.Product__c, availableStock: 0, minStock: 0, maxStock: 0, expiryDate: r.Expiry_Date__c, replenishmentStatus: r.Status__c || 'Read-only', lastUpdated: '' }));
    } catch { throw new SalesforceError('Failed to fetch batch stock policies.'); }
  }
  async getARSTriggeredOrders(): Promise<ArsTriggeredOrder[]> { return []; }

  async getBusinessInsightsEnhanced(): Promise<AIBusinessInsight[]> { throw new SalesforceError('AI insights not available via REST API (BLK-009).'); }
  async getStockThresholdRecommendations(): Promise<AIStockRecommendation[]> { throw new SalesforceError('Stock threshold AI not available via REST API (BLK-009).'); }
  async getUpsellRecommendations(): Promise<AIUpsellRecommendation[]> { throw new SalesforceError('Upsell recommendations not available via REST API (BLK-009).'); }
  async applyStockThresholdRecommendation(): Promise<AIStockRecommendation> { throw new SalesforceError('AI recommendation application not available via REST API (BLK-009).'); }
}

function normalizeApiVersion(version: string): string {
  const withoutPrefix = version.replace(/^v/i, '');
  return `v${withoutPrefix.includes('.') ? withoutPrefix : `${withoutPrefix}.0`}`;
}

function escapeSoql(value: string): string {
  return value.replace(/'/g, "\\'");
}
