import { env } from './_generated/server';
import {
  SalesforceServerlessClient,
  SalesforceServerlessError,
  createSalesforceServerlessClient,
  type SalesforceQueryResponse,
} from './salesforce';
import type {
  AIBusinessInsight,
  AIStockRecommendation,
  AIUpsellRecommendation,
  ApprovalResult,
  ApprovalStatus,
  ArsConfig,
  ArsTriggeredOrder,
  BatchStockPolicy,
  Claim,
  ClaimPayload,
  CreditNote,
  DMSInvoice,
  DMSProduct,
  DispatchRequest,
  FileUploadPayload,
  FileUploadResult,
  GoodsReceiptLine,
  GRNPayload,
  GRNResult,
  InventoryAvailability,
  InvoicePayload,
  PrimaryOrder,
  PrimaryOrderDetail,
  PrimaryOrderItemDetail,
  PrimaryOrderQuote,
  ResolvedDistributorContext,
  ReturnOrder,
  ReturnOrderDetail,
  SalesforceDescribeResult,
  SalesforceRecord,
  SecondaryOrder,
  SecondaryOrderDetail,
  SecondaryOrderGRN,
} from '../src/salesforce/types';

/**
 * The domain adapter is bound to one identity-resolved account. Public record
 * operations validate ownership against that account before touching data.
 * A new instance must be created after every Slack identity resolution.
 */
export interface SalesforceDomainOptions {
  client?: SalesforceServerlessClient;
  allowBusinessWrites?: boolean;
  now?: () => Date;
}

export class SalesforceDomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SalesforceDomainError';
  }
}

interface GoodsReceiptUpdate {
  lineId: string;
  receivedQty: number;
  lostQty: number;
  damagedQty: number;
}

interface GoodsReceiptLineRef {
  lineId: string;
  grnId: string;
  grnNumber: string;
  productId: string;
  productName: string;
  orderedQuantity: number;
}

const DESCRIBE_OBJECTS = new Set([
  'Account', 'Claim__c', 'ContentDocumentLink', 'ContentVersion', 'Credit_Note__c',
  'Credit_Note_Usage__c', 'Dispatch_Request__c', 'Goods_Receipt__c', 'GRN_Line__c',
  'Inventory__c', 'Inventory_Batch__c', 'Inventory_Policy__c', 'Invoice__c',
  'Invoice_Line_Item__c', 'Order', 'OrderItem', 'Pricebook2', 'PricebookEntry',
  'Product2', 'Return_Order__c',
]);

const GLOBAL_READ_OBJECTS = new Set([
  'Pricebook2', 'PricebookEntry', 'Product2', 'Replenishment_Settings__mdt',
  'Scheme_Slab_Target__c',
]);

export class SalesforceDomain {
  private readonly now: () => Date;

  constructor(
    private readonly context: ResolvedDistributorContext,
    private readonly client: SalesforceServerlessClient,
    private readonly allowBusinessWrites: boolean,
    now: () => Date = () => new Date(),
  ) {
    if (!context.salesforceAccountId) {
      throw new SalesforceDomainError(
        'A Salesforce account is required',
        'MISSING_ACCOUNT_SCOPE',
        'Your distributor account could not be resolved.',
      );
    }
    this.now = now;
  }

  isMock(): boolean {
    return false;
  }

  async query<T = SalesforceRecord>(soql: string): Promise<SalesforceQueryResponse<T>> {
    this.assertSafeGenericQuery(soql);
    return this.client.query<T>(soql);
  }

  async queryAll<T = SalesforceRecord>(soql: string): Promise<SalesforceQueryResponse<T>> {
    this.assertSafeGenericQuery(soql);
    return this.client.queryAll<T>(soql);
  }

  async create(objectName: string, fields: Record<string, unknown>): Promise<string> {
    this.assertWritesEnabled(`create ${objectName}`);
    await this.assertCreateOwnership(objectName, fields);
    return this.rawCreate(objectName, fields);
  }

  async update(objectName: string, id: string, fields: Record<string, unknown>): Promise<void> {
    this.assertWritesEnabled(`update ${objectName}`);
    await this.assertOwnedRecord(objectName, id);
    await this.client.update(objectName, id, fields);
  }

  async delete(objectName: string, id: string): Promise<void> {
    this.assertWritesEnabled(`delete ${objectName}`);
    await this.assertOwnedRecord(objectName, id);
    await this.client.delete(objectName, id);
  }

  async describe(objectName: string): Promise<SalesforceDescribeResult> {
    this.assertSupportedObjectName(objectName);
    return this.client.describe<SalesforceDescribeResult>(objectName);
  }

  async getRecord<T = SalesforceRecord>(objectName: string, id: string, fields?: string[]): Promise<T> {
    await this.assertOwnedRecord(objectName, id);
    return this.client.getRecord<T>(objectName, id, fields);
  }

  async getAvailableProducts(context: ResolvedDistributorContext = this.context): Promise<DMSProduct[]> {
    this.assertSameContext(context);
    try {
      const pricebook = await this.getPreferredPricebook();
      const result = await this.rawQuery<{
        Id: string;
        Product2Id: string;
        UnitPrice: number;
        Pricebook2Id: string;
        Product2: {
          Name: string;
          ProductCode: string;
          Family: string;
          IsActive: boolean;
          Unit_Of_Measure__c: string;
          Pack_Size__c: number;
          Product_Category__c: string;
          Minimum_Order_Quantity_Primary__c: number;
          Minimum_Order_Quantity_Secondary__c: number;
        };
      }>(`SELECT Id, Product2Id, UnitPrice, Pricebook2Id, Product2.Name, Product2.ProductCode, Product2.Family, Product2.IsActive, Product2.Unit_Of_Measure__c, Product2.Pack_Size__c, Product2.Product_Category__c, Product2.Minimum_Order_Quantity_Primary__c, Product2.Minimum_Order_Quantity_Secondary__c FROM PricebookEntry WHERE IsActive = true AND Pricebook2Id = '${escapeSoql(pricebook.id)}' AND Product2.IsActive = true ORDER BY Product2.Name LIMIT 200`);
      return result.records.map((row) => ({
        productId: row.Product2Id,
        pricebookEntryId: row.Id,
        pricebookId: row.Pricebook2Id,
        productCode: row.Product2.ProductCode,
        productName: row.Product2.Name,
        family: row.Product2.Family,
        category: row.Product2.Product_Category__c,
        unitOfMeasure: row.Product2.Unit_Of_Measure__c || 'Each',
        unitPrice: row.UnitPrice || 0,
        packSize: row.Product2.Pack_Size__c || 0,
        isActive: row.Product2.IsActive,
        minOrderQtyPrimary: row.Product2.Minimum_Order_Quantity_Primary__c ?? null,
        minOrderQtySecondary: row.Product2.Minimum_Order_Quantity_Secondary__c ?? null,
      }));
    } catch (error) {
      throw this.wrap(error, 'PRODUCTS_READ_FAILED', 'Unable to load product catalog.');
    }
  }

  async calculatePrimaryOrderQuote(
    context: ResolvedDistributorContext,
    lineItems: Array<{ productId: string; quantity: number; schemeDiscount?: number }>,
    creditNoteIdsOrCorrelationId: string[] | string = [],
  ): Promise<PrimaryOrderQuote> {
    this.assertSameContext(context);
    const creditNoteIds = Array.isArray(creditNoteIdsOrCorrelationId) ? creditNoteIdsOrCorrelationId : [];
    if (lineItems.length === 0 || lineItems.some((line) => !Number.isSafeInteger(line.quantity) || line.quantity <= 0)) {
      throw new SalesforceDomainError('Invalid quote quantities', 'INVALID_QUOTE', 'Each selected product must have a positive whole-number quantity.');
    }
    const products = await this.getAvailableProducts(context);
    const quoteLines = lineItems.map((item) => {
      const product = products.find((candidate) => candidate.productId === item.productId);
      if (!product) {
        throw new SalesforceDomainError('Selected product not found', 'PRODUCT_NOT_FOUND', 'One of the selected products is no longer available.');
      }
      const unitPrice = product.unitPrice || 0;
      return {
        productId: product.productId,
        pricebookEntryId: product.pricebookEntryId,
        productName: product.productName,
        productCode: product.productCode,
        quantity: item.quantity,
        unitPrice,
        totalPrice: unitPrice * item.quantity,
        unitOfMeasure: product.unitOfMeasure,
      };
    });
    const totalAmount = quoteLines.reduce((sum, line) => sum + line.totalPrice, 0);
    const autoScheme = await this.calculateAutoSchemeDiscount(quoteLines);
    const availableCreditNotes = await this.getCreditNotes(context);
    let remainingCreditCapacity = Math.max(totalAmount - autoScheme.amount, 0);
    const appliedCreditNotes = creditNoteIds
      .map((id) => availableCreditNotes.find((note) => note.creditNoteId === id))
      .filter((note): note is CreditNote => Boolean(note))
      .map((note) => {
        const amount = Math.min(Math.max(0, note.availableAmount ?? note.amount ?? 0), remainingCreditCapacity);
        remainingCreditCapacity -= amount;
        return { creditNoteId: note.creditNoteId, creditNoteNumber: note.creditNoteNumber, amount };
      })
      .filter((note) => note.amount > 0);
    const creditApplied = appliedCreditNotes.reduce((sum, note) => sum + note.amount, 0);
    const calculatedAt = this.now();
    return {
      quoteId: `quote-${calculatedAt.getTime()}`,
      lineItems: quoteLines,
      totalAmount,
      schemeDiscount: autoScheme.amount,
      discountAmount: 0,
      creditApplied,
      taxAmount: 0,
      grandTotal: Math.max(totalAmount - autoScheme.amount - creditApplied, 0),
      appliedSchemes: autoScheme.descriptions,
      appliedOffers: [],
      appliedCreditNotes,
      eligibleCreditNotes: availableCreditNotes.filter((note) => (note.availableAmount ?? note.amount) > 0),
      calculatedAt: calculatedAt.toISOString(),
      expiresAt: new Date(calculatedAt.getTime() + 30 * 60 * 1000).toISOString(),
      currency: 'INR',
    };
  }

  async createPrimaryOrder(context: ResolvedDistributorContext, quote: PrimaryOrderQuote): Promise<PrimaryOrder> {
    this.assertSameContext(context);
    this.assertWritesEnabled('create primary order');
    const today = this.now().toISOString().slice(0, 10);
    const pricebook = await this.getPreferredPricebook();
    let orderId = '';
    try {
      const fields: Record<string, unknown> = {
        AccountId: this.accountId,
        Distributor_Account__c: this.accountId,
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
        Order_Products__c: quote.lineItems.map((line) => `${line.productCode || line.productId}: ${line.quantity} ${line.unitOfMeasure || ''}`.trim()).join('\n'),
        Description: `Created from Slack DMSFA for ${context.accountName} (${context.slackEmail})`,
      };
      orderId = await this.createOrderWithFallback(fields);
      for (const line of quote.lineItems) {
        if (!line.pricebookEntryId) {
          throw new SalesforceDomainError('Missing pricebook entry', 'PRICEBOOK_ENTRY_MISSING', `Unable to create an order line for ${line.productName}; no active pricebook entry was found.`);
        }
        await this.rawCreate('OrderItem', {
          OrderId: orderId,
          PricebookEntryId: line.pricebookEntryId,
          Product2Id: line.productId,
          Quantity: line.quantity,
          UnitPrice: line.unitPrice,
          Unit_Of_Measure__c: line.unitOfMeasure,
          Original_Unit_Price__c: line.unitPrice,
          Total_Amount_with_Tax__c: line.totalPrice,
        });
      }
      for (const note of quote.appliedCreditNotes || []) {
        await this.rawCreate('Credit_Note_Usage__c', {
          Credit_Note__c: note.creditNoteId,
          Account__c: this.accountId,
          Order__c: orderId,
          Status__c: 'Applied',
          Usage_Date__c: today,
          Used_Amount__c: note.amount,
        });
      }
      try {
        await this.client.update('Order', orderId, { Status: 'Order Placed' });
      } catch {
        // The org may restrict the Order status transition. The Draft order is
        // intentionally retained for manual review, matching the legacy path.
      }
      const created = await this.client.getRecord<{ Id: string; OrderNumber?: string }>('Order', orderId, ['Id', 'OrderNumber']);
      return {
        orderId,
        orderNumber: created.OrderNumber || orderId,
        distributorId: this.accountId,
        status: 'Draft',
        totalAmount: quote.totalAmount,
        schemeDiscount: quote.schemeDiscount,
        discountAmount: quote.discountAmount,
        grandTotal: quote.grandTotal,
        taxAmount: quote.taxAmount,
        orderDate: today,
        items: quote.lineItems.map((line, index) => ({
          itemId: `item-${index}-${line.productId.slice(-4)}`,
          productId: line.productId,
          productName: line.productName,
          productCode: line.productCode,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalPrice: line.totalPrice,
          unitOfMeasure: line.unitOfMeasure,
        })),
        approvalStatus: 'None',
        creditApplied: quote.creditApplied || 0,
        appliedCreditNotes: quote.appliedCreditNotes || [],
      };
    } catch (error) {
      if (error instanceof SalesforceDomainError) throw error;
      throw this.wrap(
        error,
        'PRIMARY_ORDER_CREATE_FAILED',
        orderId
          ? `Order header was created in Salesforce (${orderId}), but one or more line items failed. The order was left in Draft for review.`
          : 'Unable to create order. Please try again.',
      );
    }
  }

  async getPrimaryOrders(context: ResolvedDistributorContext = this.context): Promise<PrimaryOrder[]> {
    this.assertSameContext(context);
    try {
      const result = await this.rawQuery<{
        Id: string;
        OrderNumber: string;
        AccountId: string;
        Status: string;
        EffectiveDate: string;
        TotalAmount: number;
        Grand_Total__c: number;
        Discount_Amount__c: number;
        Credit_Applied__c: number;
        Tax_Amount__c: number;
        Approval_Status__c: string;
      }>(`SELECT Id, OrderNumber, AccountId, Status, Type, EffectiveDate, TotalAmount, Grand_Total__c, Discount_Amount__c, Credit_Applied__c, Tax_Amount__c, Approval_Status__c FROM Order WHERE AccountId = '${this.escapedAccountId}' AND Type = 'Primary' ORDER BY CreatedDate DESC LIMIT 50`);
      return result.records.map((row) => ({
        orderId: row.Id,
        orderNumber: row.OrderNumber,
        distributorId: row.AccountId,
        status: row.Status,
        totalAmount: row.TotalAmount || row.Grand_Total__c || 0,
        schemeDiscount: row.Discount_Amount__c || 0,
        discountAmount: 0,
        grandTotal: row.Grand_Total__c || row.TotalAmount || 0,
        taxAmount: row.Tax_Amount__c || 0,
        orderDate: row.EffectiveDate,
        items: [],
        approvalStatus: row.Approval_Status__c || row.Status,
        creditApplied: row.Credit_Applied__c || 0,
      }));
    } catch (error) {
      throw this.wrap(error, 'PRIMARY_ORDERS_READ_FAILED', 'Unable to load your orders.');
    }
  }

  async getPrimaryOrderDetails(context: ResolvedDistributorContext, orderId: string): Promise<PrimaryOrderDetail> {
    this.assertSameContext(context);
    try {
      const escapedOrderId = escapeSoql(orderId);
      const result = await this.rawQuery<{
        Id: string;
        OrderNumber: string;
        AccountId: string;
        Status: string;
        EffectiveDate: string;
        TotalAmount: number;
        Grand_Total__c: number;
        Discount_Amount__c: number;
        Credit_Applied__c: number;
        Tax_Amount__c: number;
        Approval_Status__c: string;
      }>(`SELECT Id, OrderNumber, AccountId, Status, Type, EffectiveDate, TotalAmount, Grand_Total__c, Discount_Amount__c, Credit_Applied__c, Tax_Amount__c, Approval_Status__c, Order_Products__c, Description FROM Order WHERE Id = '${escapedOrderId}' AND AccountId = '${this.escapedAccountId}' AND Type = 'Primary' LIMIT 1`);
      const row = result.records[0];
      if (!row) this.notFound('Primary order');
      const [items, grnIds, returnOrderIds, invoiceIds, dispatchIds, creditNoteUsageIds] = await Promise.all([
        this.getOrderItems(row.Id),
        this.getRelatedIds('Goods_Receipt__c', 'Order__c', row.Id),
        this.getRelatedIds('Return_Order__c', 'Order__c', row.Id),
        this.getRelatedIds('Invoice__c', 'Order__c', row.Id),
        this.getRelatedIds('Dispatch_Request__c', 'Order__c', row.Id),
        this.getRelatedIds('Credit_Note_Usage__c', 'Order__c', row.Id),
      ]);
      return {
        orderId: row.Id,
        orderNumber: row.OrderNumber,
        distributorId: row.AccountId,
        status: row.Status,
        totalAmount: row.TotalAmount || row.Grand_Total__c || 0,
        schemeDiscount: row.Discount_Amount__c || 0,
        discountAmount: 0,
        grandTotal: row.Grand_Total__c || row.TotalAmount || 0,
        taxAmount: row.Tax_Amount__c || 0,
        orderDate: row.EffectiveDate,
        items,
        approvalStatus: row.Approval_Status__c || row.Status,
        fulfillmentStatus: 'Unknown',
        grnIds,
        returnOrderIds,
        invoiceIds,
        dispatchIds,
        creditApplied: row.Credit_Applied__c || 0,
        creditNoteUsageIds,
      };
    } catch (error) {
      if (error instanceof SalesforceDomainError) throw error;
      throw this.wrap(error, 'PRIMARY_ORDER_READ_FAILED', 'Unable to load order details.');
    }
  }

  async markPrimaryOrderDelivered(context: ResolvedDistributorContext, orderId: string): Promise<void> {
    await this.getPrimaryOrderDetails(context, orderId);
    this.assertWritesEnabled('mark primary order delivered');
    await this.client.update('Order', orderId, { Status: 'Delivered' });
  }

  async createOrUpdateGRN(context: ResolvedDistributorContext, orderId: string, grnData: GRNPayload): Promise<GRNResult> {
    this.assertSameContext(context);
    this.assertWritesEnabled('update primary order GRN');
    const order = await this.rawQuery<{ Id: string }>(
      `SELECT Id FROM Order WHERE Id = '${escapeSoql(orderId)}' AND AccountId = '${this.escapedAccountId}' AND Type = 'Primary' LIMIT 1`,
    );
    if (!order.records[0]) this.notFound('Primary order');
    const lines = await this.getGoodsReceiptLines(context, orderId);
    if (lines.length === 0) {
      throw new SalesforceDomainError(
        'No GRN lines found for order',
        'GRN_NOT_GENERATED',
        'The Goods Receipt Note for this order has not been generated yet. It is created automatically once the order is marked Delivered in Salesforce — please try again shortly.',
      );
    }
    const lineByProduct = new Map(lines.map((line) => [line.productId, line]));
    const updates = grnData.items.flatMap((item) => {
      const line = lineByProduct.get(item.productId);
      return line ? [{ lineId: line.lineId, receivedQty: item.receivedQuantity, lostQty: item.missingQuantity, damagedQty: item.damagedQuantity }] : [];
    });
    if (updates.length === 0) {
      throw new SalesforceDomainError('No matching GRN lines', 'GRN_LINES_MISMATCH', 'None of the submitted products matched the generated GRN lines for this order.');
    }
    const applied = await this.applyGoodsReceipt(lines, updates);
    return {
      grnId: applied.grnId,
      grnNumber: applied.grnNumber,
      orderId,
      status: applied.headerStatus,
      createdReturnOrderId: undefined,
      items: grnData.items.map((item) => ({
        productId: item.productId,
        receivedQuantity: item.receivedQuantity,
        damagedQuantity: item.damagedQuantity,
        missingQuantity: item.missingQuantity,
      })),
      notes: grnData.notes,
    };
  }

  async getGRNDetails(context: ResolvedDistributorContext, grnId: string): Promise<GRNResult> {
    this.assertSameContext(context);
    const result = await this.rawQuery<{
      Id: string;
      Name: string;
      Status__c: string;
      Order__c: string;
    }>(`SELECT Id, Name, Status__c, Order__c FROM Goods_Receipt__c WHERE Id = '${escapeSoql(grnId)}' AND (Order__r.AccountId = '${this.escapedAccountId}' OR Order__r.Distributor_Account__c = '${this.escapedAccountId}') LIMIT 1`);
    const row = result.records[0];
    if (!row) this.notFound('Goods receipt');
    return { grnId: row.Id, grnNumber: row.Name, orderId: row.Order__c || '', status: row.Status__c, items: [], notes: '' };
  }

  async getReturnOrders(context: ResolvedDistributorContext = this.context): Promise<ReturnOrder[]> {
    this.assertSameContext(context);
    try {
      const result = await this.rawQuery<{
        Id: string;
        Name: string;
        Account__c: string;
        Order__c?: string;
        Status__c: string;
        Grand_Total__c: number;
        Description__c: string;
        Type__c: string;
      }>(`SELECT Id, Name, Account__c, Order__c, Status__c, Grand_Total__c, Description__c, Type__c FROM Return_Order__c WHERE Account__c = '${this.escapedAccountId}' ORDER BY CreatedDate DESC LIMIT 50`);
      return result.records.map((row) => ({
        returnId: row.Id,
        returnNumber: row.Name,
        accountId: row.Account__c,
        orderId: row.Order__c,
        status: row.Status__c,
        grandTotal: row.Grand_Total__c || 0,
        description: row.Description__c,
        type: row.Type__c,
        items: [],
      }));
    } catch (error) {
      throw this.wrap(error, 'RETURNS_READ_FAILED', 'Unable to load return orders.');
    }
  }

  async getReturnOrderDetails(context: ResolvedDistributorContext, returnOrderId: string): Promise<ReturnOrderDetail> {
    this.assertSameContext(context);
    try {
      const result = await this.rawQuery<{
        Id: string;
        Name: string;
        Account__c: string;
        Order__c?: string;
        Status__c: string;
        Grand_Total__c: number;
        Description__c: string;
        Type__c: string;
      }>(`SELECT Id, Name, Account__c, Order__c, Status__c, Grand_Total__c, Description__c, Type__c FROM Return_Order__c WHERE Id = '${escapeSoql(returnOrderId)}' AND Account__c = '${this.escapedAccountId}' LIMIT 1`);
      const row = result.records[0];
      if (!row) this.notFound('Return order');
      const [claims, creditNotes] = await Promise.all([
        this.getClaims(context, row.Id),
        this.getCreditNotes(context, row.Id),
      ]);
      return {
        returnId: row.Id,
        returnNumber: row.Name,
        accountId: row.Account__c,
        orderId: row.Order__c,
        status: row.Status__c,
        grandTotal: row.Grand_Total__c || 0,
        description: row.Description__c,
        type: row.Type__c,
        items: [],
        approvalStatus: row.Status__c,
        claimIds: claims.map((claim) => claim.claimId),
        creditNoteIds: creditNotes.map((note) => note.creditNoteId),
      };
    } catch (error) {
      if (error instanceof SalesforceDomainError) throw error;
      throw this.wrap(error, 'RETURN_READ_FAILED', 'Unable to load return order details.');
    }
  }

  async getClaims(context: ResolvedDistributorContext, returnOrderId?: string): Promise<Claim[]> {
    this.assertSameContext(context);
    try {
      let soql: string;
      if (returnOrderId) {
        const ownedReturn = await this.rawQuery<{ Id: string }>(`SELECT Id FROM Return_Order__c WHERE Id = '${escapeSoql(returnOrderId)}' AND Account__c = '${this.escapedAccountId}' LIMIT 1`);
        if (!ownedReturn.records[0]) return [];
        soql = `SELECT Id, Name, Order__c, Return_Order__c, Claim_Type__c, Status__c, Amount__c, Total_Amount__c, Claim_Number__c FROM Claim__c WHERE Return_Order__c = '${escapeSoql(returnOrderId)}' ORDER BY CreatedDate DESC LIMIT 50`;
      } else {
        const orders = await this.rawQuery<{ Id: string }>(`SELECT Id FROM Order WHERE AccountId = '${this.escapedAccountId}' OR Distributor_Account__c = '${this.escapedAccountId}' LIMIT 200`);
        if (orders.records.length === 0) return [];
        const orderIds = orders.records.map((order) => `'${escapeSoql(order.Id)}'`).join(',');
        soql = `SELECT Id, Name, Order__c, Return_Order__c, Claim_Type__c, Status__c, Amount__c, Total_Amount__c, Claim_Number__c FROM Claim__c WHERE (Retailer_Account__c = '${this.escapedAccountId}' OR Order__c IN (${orderIds})) ORDER BY CreatedDate DESC LIMIT 50`;
      }
      const result = await this.rawQuery<{
        Id: string;
        Name: string;
        Order__c?: string;
        Return_Order__c?: string;
        Claim_Type__c: string;
        Status__c: string;
        Amount__c: number;
        Total_Amount__c: number;
        Claim_Number__c: string;
      }>(soql);
      return result.records.map((row) => ({
        claimId: row.Id,
        claimNumber: row.Claim_Number__c || row.Name,
        accountId: this.accountId,
        orderId: row.Order__c,
        returnOrderId: row.Return_Order__c,
        claimType: row.Claim_Type__c,
        status: row.Status__c,
        amount: row.Amount__c || 0,
        totalAmount: row.Total_Amount__c || 0,
      }));
    } catch (error) {
      throw this.wrap(error, 'CLAIMS_READ_FAILED', 'Unable to load claims.');
    }
  }

  async createOrUpdateClaim(context: ResolvedDistributorContext, claimData: ClaimPayload): Promise<Claim> {
    this.assertSameContext(context);
    this.assertWritesEnabled('create claim');
    if (claimData.returnOrderId) await this.assertOwnedRecord('Return_Order__c', claimData.returnOrderId);
    if (claimData.orderId) await this.assertOwnedRecord('Order', claimData.orderId);
    if (!claimData.returnOrderId && !claimData.orderId) {
      throw new SalesforceDomainError('Claim lacks a related owned record', 'CLAIM_RELATION_REQUIRED', 'A claim must be linked to one of your orders or returns.');
    }
    if (!Number.isFinite(claimData.amount) || claimData.amount < 0) {
      throw new SalesforceDomainError('Invalid claim amount', 'INVALID_CLAIM_AMOUNT', 'Enter a valid claim amount.');
    }
    try {
      const fields: Record<string, unknown> = {
        Retailer_Account__c: this.accountId,
        Claim_Type__c: claimData.claimType,
        Status__c: 'Open',
        Amount__c: claimData.amount,
        Total_Amount__c: claimData.amount,
      };
      if (claimData.returnOrderId) fields.Return_Order__c = claimData.returnOrderId;
      if (claimData.orderId) fields.Order__c = claimData.orderId;
      const claimId = await this.rawCreate('Claim__c', fields);
      return {
        claimId,
        claimNumber: `CLM-${claimId.slice(-4)}`,
        accountId: this.accountId,
        orderId: claimData.orderId,
        returnOrderId: claimData.returnOrderId,
        claimType: claimData.claimType,
        status: 'Open',
        amount: claimData.amount,
        totalAmount: claimData.amount,
        notes: claimData.description,
      };
    } catch (error) {
      throw this.wrap(error, 'CLAIM_CREATE_FAILED', 'Unable to create claim.');
    }
  }

  async uploadFileToRecord(
    context: ResolvedDistributorContext,
    recordId: string,
    filePayload: FileUploadPayload,
  ): Promise<FileUploadResult> {
    this.assertSameContext(context);
    this.assertWritesEnabled('upload Salesforce file');
    await this.assertAnyOwnedBusinessRecord(recordId);
    if (!filePayload.fileName || !filePayload.contentBase64) {
      throw new SalesforceDomainError('Invalid file payload', 'INVALID_FILE', 'The selected file is empty or invalid.');
    }
    try {
      const contentVersionId = await this.rawCreate('ContentVersion', {
        Title: filePayload.fileName,
        PathOnClient: filePayload.fileName,
        VersionData: filePayload.contentBase64,
        IsMajorVersion: true,
        Description: filePayload.description || '',
      });
      const version = await this.rawQuery<{ Id: string; ContentDocumentId: string }>(
        `SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = '${escapeSoql(contentVersionId)}' LIMIT 1`,
      );
      const contentDocumentId = version.records[0]?.ContentDocumentId;
      if (!contentDocumentId) throw new Error('ContentVersion was not readable after create');
      await this.rawCreate('ContentDocumentLink', {
        ContentDocumentId: contentDocumentId,
        LinkedEntityId: recordId,
        ShareType: 'V',
        Visibility: 'AllUsers',
      });
      return { fileId: contentVersionId, contentDocumentId, linkedToRecord: recordId };
    } catch (error) {
      throw this.wrap(error, 'FILE_UPLOAD_FAILED', 'Unable to upload file.');
    }
  }

  async submitForApproval(
    context: ResolvedDistributorContext,
    recordId: string,
    objectName: string,
  ): Promise<ApprovalResult> {
    this.assertSameContext(context);
    if (objectName !== 'Return_Order__c') {
      throw new SalesforceDomainError('Unsupported approval object', 'APPROVAL_OBJECT_UNSUPPORTED', 'Approval is not available for this record type.');
    }
    await this.assertOwnedRecord(objectName, recordId);
    return {
      success: false,
      newStatus: 'Unknown',
      message: 'Approval submission not available via existing Salesforce REST API.',
    };
  }

  async getApprovalStatus(
    context: ResolvedDistributorContext,
    recordId: string,
    objectName: string,
  ): Promise<ApprovalStatus> {
    this.assertSameContext(context);
    if (objectName !== 'Return_Order__c') {
      return { recordId, status: 'Unknown', isPending: false, isApproved: false, isRejected: false };
    }
    try {
      const result = await this.rawQuery<{ Id: string; Approval_Status__c: string }>(
        `SELECT Id, Approval_Status__c FROM Return_Order__c WHERE Id = '${escapeSoql(recordId)}' AND Account__c = '${this.escapedAccountId}' LIMIT 1`,
      );
      const status = result.records[0]?.Approval_Status__c || 'Unknown';
      return {
        recordId,
        status,
        isPending: status === 'Pending',
        isApproved: status === 'Approved',
        isRejected: status === 'Rejected',
      };
    } catch {
      return { recordId, status: 'Unknown', isPending: false, isApproved: false, isRejected: false };
    }
  }

  async getCreditNotes(context: ResolvedDistributorContext, returnOrderId?: string): Promise<CreditNote[]> {
    this.assertSameContext(context);
    if (returnOrderId) await this.assertOwnedRecord('Return_Order__c', returnOrderId);
    try {
      const returnFilter = returnOrderId ? ` AND Return_Order__c = '${escapeSoql(returnOrderId)}'` : '';
      const result = await this.rawQuery<{
        Id: string;
        Name: string;
        Account__c: string;
        Status__c: string;
        Amount__c: number;
        Used_Amount__c?: number;
        Available_Amount__c?: number;
        Return_Order__c?: string;
        Claim__c?: string;
        CreatedDate?: string;
        Type__c?: string;
      }>(`SELECT Id, Name, Account__c, Status__c, Amount__c, Used_Amount__c, Available_Amount__c, Return_Order__c, Claim__c, CreatedDate, Type__c FROM Credit_Note__c WHERE Account__c = '${this.escapedAccountId}'${returnFilter} ORDER BY CreatedDate DESC LIMIT 50`);
      return result.records.map((row) => ({
        creditNoteId: row.Id,
        creditNoteNumber: row.Name,
        accountId: row.Account__c,
        returnOrderId: row.Return_Order__c,
        claimId: row.Claim__c,
        status: row.Status__c,
        amount: row.Amount__c || 0,
        usedAmount: row.Used_Amount__c || 0,
        availableAmount: row.Available_Amount__c ?? row.Amount__c ?? 0,
        createdDate: row.CreatedDate,
        type: row.Type__c,
      }));
    } catch (error) {
      throw this.wrap(error, 'CREDIT_NOTES_READ_FAILED', 'Unable to load credit notes.');
    }
  }

  async getSecondaryOrders(context: ResolvedDistributorContext = this.context): Promise<SecondaryOrder[]> {
    this.assertSameContext(context);
    try {
      const records = (await this.rawQuery<{
        Id: string;
        OrderNumber: string;
        AccountId: string;
        Distributor_Account__c?: string;
        Retailer_Account__c?: string;
        Retailer_Account__r?: { Name?: string };
        Status: string;
        TotalAmount: number;
        Grand_Total__c?: number;
        EffectiveDate: string;
        Type?: string;
      }>(`SELECT Id, OrderNumber, AccountId, Distributor_Account__c, Retailer_Account__c, Retailer_Account__r.Name, Status, TotalAmount, Grand_Total__c, EffectiveDate, Type FROM Order WHERE (AccountId = '${this.escapedAccountId}' OR Distributor_Account__c = '${this.escapedAccountId}') AND Type = 'Secondary' ORDER BY CreatedDate DESC LIMIT 50`)).records;
      const retailerIds = [...new Set(records
        .filter((record) => !record.Retailer_Account__r?.Name && record.Retailer_Account__c)
        .map((record) => record.Retailer_Account__c as string))];
      const retailerNames = new Map<string, string>();
      if (retailerIds.length > 0) {
        try {
          const ids = retailerIds.map((id) => `'${escapeSoql(id)}'`).join(',');
          const accounts = await this.rawQuery<{ Id: string; Name: string }>(`SELECT Id, Name FROM Account WHERE Id IN (${ids})`);
          for (const account of accounts.records) retailerNames.set(account.Id, account.Name);
        } catch {
          // Retailer name is display-only; do not fail the order list.
        }
      }
      return records.map((row) => ({
        orderId: row.Id,
        orderNumber: row.OrderNumber,
        distributorId: row.Distributor_Account__c || row.AccountId,
        retailerCustomer: row.Retailer_Account__r?.Name || retailerNames.get(row.Retailer_Account__c || '') || row.Retailer_Account__c || 'Unknown Retailer',
        status: row.Status,
        totalAmount: row.TotalAmount || row.Grand_Total__c || 0,
        fulfillmentStatus: row.Status,
        invoiceStatus: '',
        dispatchStatus: '',
        orderDate: row.EffectiveDate || '',
        items: [],
        type: row.Type,
      }));
    } catch (error) {
      throw this.wrap(error, 'SECONDARY_ORDERS_READ_FAILED', 'Unable to load secondary orders.');
    }
  }

  async getSecondaryOrderDetails(context: ResolvedDistributorContext, secondaryOrderId: string): Promise<SecondaryOrderDetail> {
    this.assertSameContext(context);
    try {
      const escapedOrderId = escapeSoql(secondaryOrderId);
      const result = await this.rawQuery<{
        Id: string;
        OrderNumber: string;
        AccountId: string;
        Distributor_Account__c?: string;
        Retailer_Account__c?: string;
        Retailer_Account__r?: { Name?: string };
        Status: string;
        TotalAmount: number;
        Grand_Total__c?: number;
        EffectiveDate: string;
      }>(`SELECT Id, OrderNumber, AccountId, Distributor_Account__c, Retailer_Account__c, Retailer_Account__r.Name, Status, TotalAmount, Grand_Total__c, EffectiveDate FROM Order WHERE Id = '${escapedOrderId}' AND (AccountId = '${this.escapedAccountId}' OR Distributor_Account__c = '${this.escapedAccountId}') AND Type = 'Secondary' LIMIT 1`);
      const row = result.records[0];
      if (!row) this.notFound('Secondary order');
      const fulfillmentStatus = row.Status || 'Unknown';
      const isFullyFulfilled = ['Fully Invoiced', 'Fully Fulfilled'].includes(fulfillmentStatus);
      const [orderItems, invoiceIds, dispatchRecords, grnIds, sourceAddress] = await Promise.all([
        this.getOrderItems(row.Id),
        this.getRelatedIds('Invoice__c', 'Order__c', row.Id),
        this.rawQuery<{ Id: string; Status__c: string }>(`SELECT Id, Status__c FROM Dispatch_Request__c WHERE Order__c = '${escapedOrderId}' ORDER BY CreatedDate DESC LIMIT 20`).then((response) => response.records),
        this.getRelatedIds('Goods_Receipt__c', 'Order__c', row.Id),
        this.getShippingAddress(row.AccountId),
      ]);
      const dispatchIds = dispatchRecords.map((dispatch) => dispatch.Id);
      const hasPendingDispatch = dispatchRecords.some((dispatch) => dispatch.Status__c !== 'Delivered');
      const retailerId = row.Retailer_Account__c;
      const retailerName = row.Retailer_Account__r?.Name || (retailerId ? await this.lookupAccountName(retailerId) : 'Unknown Retailer');
      const destinationAddress = retailerId ? await this.getShippingAddress(retailerId) : '';
      const items = orderItems.map((item) => {
        const pendingQuantity = item.remainingQty != null
          ? item.remainingQty
          : Math.max(0, item.quantity - item.fulfilledQuantity);
        return {
          itemId: item.itemId,
          productId: item.productId,
          productName: item.productName,
          orderedQuantity: item.quantity,
          availableQuantity: 0,
          fulfilledQuantity: item.fulfilledQuantity,
          pendingQuantity,
          unitPrice: item.unitPrice,
          unitOfMeasure: item.unitOfMeasure,
        };
      });
      const remainingQtys = items
        .filter((item) => item.pendingQuantity > 0)
        .map((item) => ({ productId: item.productId, productName: item.productName, orderedQty: item.orderedQuantity, remainingQty: item.pendingQuantity }));
      return {
        orderId: row.Id,
        orderNumber: row.OrderNumber,
        distributorId: row.Distributor_Account__c || row.AccountId,
        retailerCustomer: retailerName,
        status: row.Status,
        totalAmount: row.TotalAmount || row.Grand_Total__c || 0,
        fulfillmentStatus,
        invoiceStatus: invoiceIds.length === 0 ? 'Not Invoiced' : isFullyFulfilled ? 'Fully Invoiced' : 'Partially Invoiced',
        dispatchStatus: dispatchIds.length === 0 ? 'No Dispatch' : hasPendingDispatch ? 'In Transit' : 'All Delivered',
        orderDate: row.EffectiveDate,
        items,
        invoiceIds,
        dispatchIds,
        grnIds,
        canCreateInvoice: !isFullyFulfilled && items.some((item) => item.pendingQuantity > 0),
        canUpdateDispatch: hasPendingDispatch,
        hasPendingDispatch,
        sourceAddress,
        destinationAddress: destinationAddress || retailerName,
        type: 'Secondary',
        remainingQtys,
      };
    } catch (error) {
      if (error instanceof SalesforceDomainError) throw error;
      throw this.wrap(error, 'SECONDARY_ORDER_READ_FAILED', 'Unable to load secondary order details.');
    }
  }

  async getInventoryAvailability(context: ResolvedDistributorContext, secondaryOrderId: string): Promise<InventoryAvailability[]> {
    this.assertSameContext(context);
    const detail = await this.getSecondaryOrderDetails(context, secondaryOrderId);
    const pendingItems = detail.items.filter((item) => item.pendingQuantity > 0);
    if (pendingItems.length === 0) return [];
    const inventory = await this.getProductInventory(pendingItems.map((item) => item.productId));
    return pendingItems.map((item) => {
      const record = inventory.get(item.productId);
      return {
        productId: item.productId,
        productName: item.productName,
        orderedQuantity: item.pendingQuantity,
        availableQuantity: record ? Math.min(record.qty, item.pendingQuantity) : 0,
        batchDetails: record?.batches ?? [],
      };
    });
  }

  async createInvoice(
    context: ResolvedDistributorContext,
    secondaryOrderId: string,
    payload: InvoicePayload,
  ): Promise<DMSInvoice> {
    this.assertSameContext(context);
    this.assertWritesEnabled('create secondary invoice');
    const detail = await this.getSecondaryOrderDetails(context, secondaryOrderId);
    const requestedItems = payload.items.filter((item) => item.quantity > 0);
    if (requestedItems.length === 0) {
      throw new SalesforceDomainError('No items to invoice', 'NO_INVOICE_ITEMS', 'No stock available to invoice. Check inventory levels.');
    }
    const requestedProductIds = new Set<string>();
    for (const requested of requestedItems) {
      if (requestedProductIds.has(requested.productId)) {
        throw new SalesforceDomainError('Duplicate invoice product', 'DUPLICATE_INVOICE_PRODUCT', 'Each product may appear only once on an invoice.');
      }
      requestedProductIds.add(requested.productId);
      if (!Number.isSafeInteger(requested.quantity) || requested.quantity <= 0) {
        throw new SalesforceDomainError('Invalid invoice quantity', 'INVALID_INVOICE_QUANTITY', 'Invoice quantities must be positive whole numbers.');
      }
      const orderItem = detail.items.find((item) => item.productId === requested.productId);
      if (!orderItem || requested.quantity > orderItem.pendingQuantity) {
        throw new SalesforceDomainError('Invoice exceeds pending quantity', 'INVOICE_QUANTITY_EXCEEDS_PENDING', 'An invoice quantity exceeds the remaining quantity on this order.');
      }
    }
    const availability = await this.getInventoryAvailability(context, secondaryOrderId);
    for (const requested of requestedItems) {
      const available = availability.find((item) => item.productId === requested.productId)?.availableQuantity ?? 0;
      if (requested.quantity > available) {
        throw new SalesforceDomainError('Invoice exceeds available stock', 'INVOICE_QUANTITY_EXCEEDS_STOCK', 'An invoice quantity exceeds available distributor stock.');
      }
    }

    const priceByProduct = new Map(detail.items.map((item) => [item.productId, item.unitPrice]));
    const totalAmount = requestedItems.reduce((sum, item) => sum + (priceByProduct.get(item.productId) || 0) * item.quantity, 0);
    const today = this.now().toISOString().slice(0, 10);
    const fullPartialValue = /partial/i.test(payload.fullOrPartial) ? 'Partial Invoice' : 'Full Invoice';
    let invoiceId = '';
    try {
      invoiceId = await this.rawCreate('Invoice__c', {
        Billing_Account__c: this.accountId,
        Order__c: secondaryOrderId,
        Status__c: 'New',
        Total_Amount__c: totalAmount,
        Invoice_Amount__c: totalAmount,
        Invoice_Date__c: today,
        Full_Partial__c: fullPartialValue,
        Type__c: 'Secondary',
      });
      for (const item of requestedItems) {
        const unitPrice = priceByProduct.get(item.productId) || 0;
        try {
          await this.rawCreate('Invoice_Line_Item__c', {
            Invoice_Custom__c: invoiceId,
            Product__c: item.productId,
            Quantity__c: item.quantity,
            Unit_Price__c: unitPrice,
            Total_Price__c: unitPrice * item.quantity,
            Total_Amount_with_Tax__c: unitPrice * item.quantity,
          });
        } catch {
          // Preserve the legacy partial-failure contract: an invoice header is
          // retained if an org-specific line field is unavailable.
        }
      }
      try {
        const inventory = await this.getProductInventory(requestedItems.map((item) => item.productId));
        for (const item of requestedItems) {
          let remaining = item.quantity;
          for (const batch of inventory.get(item.productId)?.batches ?? []) {
            if (remaining <= 0) break;
            const deduction = Math.min(remaining, batch.quantity);
            try {
              const primaryField = batch.objectName === 'Inventory__c' ? 'Quantity_Available__c' : 'Quantity__c';
              await this.client.update(batch.objectName, batch.batchId, { [primaryField]: batch.quantity - deduction });
            } catch {
              try {
                const fallbackField = batch.objectName === 'Inventory__c' ? 'Total_Quantity__c' : 'Available_Quantity__c';
                await this.client.update(batch.objectName, batch.batchId, { [fallbackField]: batch.quantity - deduction });
              } catch {
                // Inventory field names vary by org; invoice creation remains
                // successful, matching the existing best-effort behavior.
              }
            }
            remaining -= deduction;
          }
        }
      } catch {
        // Best-effort inventory adjustment; Salesforce automations may own it.
      }

      try {
        const order = await this.rawQuery<{ AccountId: string; Retailer_Account__c?: string }>(
          `SELECT AccountId, Retailer_Account__c FROM Order WHERE Id = '${escapeSoql(secondaryOrderId)}' AND (AccountId = '${this.escapedAccountId}' OR Distributor_Account__c = '${this.escapedAccountId}') AND Type = 'Secondary' LIMIT 1`,
        );
        const distributorId = order.records[0]?.AccountId || this.accountId;
        const retailerId = order.records[0]?.Retailer_Account__c;
        const [sourceAddress, destinationAddress] = await Promise.all([
          this.getShippingAddress(distributorId),
          retailerId ? this.getShippingAddress(retailerId) : Promise.resolve(''),
        ]);
        await this.rawCreate('Dispatch_Request__c', {
          Order__c: secondaryOrderId,
          Invoice_Custom__c: invoiceId,
          Status__c: 'Draft',
          Dispatch_Request_Name__c: `DSP-${invoiceId.slice(-6).toUpperCase()}`,
          Source_Address__c: sourceAddress || this.accountId,
          Destination_Address__c: destinationAddress || retailerId || '',
          Start_Date__c: today,
        });
      } catch {
        // Dispatch creation is deliberately best effort after invoice creation.
      }

      try {
        const fulfilled = await this.getFulfilledQtyByProduct(secondaryOrderId);
        const allFulfilled = detail.items.every((item) => (fulfilled.get(item.productId) || 0) >= item.orderedQuantity);
        await this.client.update('Order', secondaryOrderId, { Sub_Status__c: allFulfilled ? 'Fully Invoiced' : 'Partially Invoiced' });
      } catch {
        // The header status is display-only and may be flow-managed.
      }
      return {
        invoiceId,
        invoiceNumber: `INV-${invoiceId.slice(-6).toUpperCase()}`,
        accountId: this.accountId,
        orderId: secondaryOrderId,
        status: 'Generated',
        totalAmount,
        invoiceDate: today,
        paymentStatus: 'Unpaid',
        type: 'Secondary',
        fullPartial: fullPartialValue,
      };
    } catch (error) {
      if (error instanceof SalesforceDomainError) throw error;
      throw this.wrap(
        error,
        'INVOICE_CREATE_FAILED',
        invoiceId
          ? `Invoice header ${invoiceId} was created, but a later fulfillment step failed. Review the Salesforce record before retrying.`
          : 'Unable to create invoice. Please try again.',
      );
    }
  }

  async getInvoiceDetails(context: ResolvedDistributorContext, invoiceId: string): Promise<DMSInvoice> {
    this.assertSameContext(context);
    const result = await this.rawQuery<{
      Id: string;
      Name: string;
      Billing_Account__c: string;
      Order__c?: string;
      Status__c: string;
      Total_Amount__c?: number;
      Invoice_Date__c?: string;
      Payment_Status__c?: string;
      Full_Partial__c?: string;
      Type__c?: string;
    }>(`SELECT Id, Name, Billing_Account__c, Order__c, Status__c, Total_Amount__c, Invoice_Date__c, Payment_Status__c, Full_Partial__c, Type__c FROM Invoice__c WHERE Id = '${escapeSoql(invoiceId)}' AND (Billing_Account__c = '${this.escapedAccountId}' OR Order__r.AccountId = '${this.escapedAccountId}' OR Order__r.Distributor_Account__c = '${this.escapedAccountId}') LIMIT 1`);
    const row = result.records[0];
    if (!row) this.notFound('Invoice');
    return {
      invoiceId: row.Id,
      invoiceNumber: row.Name,
      accountId: row.Billing_Account__c,
      orderId: row.Order__c,
      status: row.Status__c,
      totalAmount: row.Total_Amount__c || 0,
      invoiceDate: row.Invoice_Date__c,
      paymentStatus: row.Payment_Status__c,
      type: row.Type__c,
      fullPartial: row.Full_Partial__c,
    };
  }

  async getDispatchRequests(context: ResolvedDistributorContext, secondaryOrderId: string): Promise<DispatchRequest[]> {
    this.assertSameContext(context);
    await this.assertOwnedSecondaryOrder(secondaryOrderId);
    const result = await this.rawQuery<{
      Id: string;
      Dispatch_Request_Name__c?: string;
      Order__c?: string;
      Status__c: string;
      Invoice_Custom__c?: string;
      Start_Date__c?: string;
      End_Date__c?: string;
      Source_Address__c?: string;
      Destination_Address__c?: string;
    }>(`SELECT Id, Dispatch_Request_Name__c, Order__c, Status__c, Invoice_Custom__c, Start_Date__c, End_Date__c, Source_Address__c, Destination_Address__c FROM Dispatch_Request__c WHERE Order__c = '${escapeSoql(secondaryOrderId)}' AND (Order__r.AccountId = '${this.escapedAccountId}' OR Order__r.Distributor_Account__c = '${this.escapedAccountId}') ORDER BY CreatedDate DESC LIMIT 20`);
    return result.records.map((row) => this.mapDispatch(row));
  }

  async updateDispatchStatus(
    context: ResolvedDistributorContext,
    dispatchRequestId: string,
    newStatus: string,
  ): Promise<DispatchRequest> {
    this.assertSameContext(context);
    this.assertWritesEnabled('update dispatch status');
    const allowedStatuses = new Set(['Draft', 'In Transit', 'Dispatched', 'Delivered', 'Cancelled']);
    if (!allowedStatuses.has(newStatus)) {
      throw new SalesforceDomainError('Invalid dispatch status', 'INVALID_DISPATCH_STATUS', 'The requested dispatch status is not supported.');
    }
    const result = await this.rawQuery<{
      Id: string;
      Dispatch_Request_Name__c?: string;
      Order__c?: string;
      Status__c: string;
      Invoice_Custom__c?: string;
      Start_Date__c?: string;
      End_Date__c?: string;
      Source_Address__c?: string;
      Destination_Address__c?: string;
    }>(`SELECT Id, Dispatch_Request_Name__c, Order__c, Status__c, Invoice_Custom__c, Start_Date__c, End_Date__c, Source_Address__c, Destination_Address__c FROM Dispatch_Request__c WHERE Id = '${escapeSoql(dispatchRequestId)}' AND (Order__r.AccountId = '${this.escapedAccountId}' OR Order__r.Distributor_Account__c = '${this.escapedAccountId}') LIMIT 1`);
    const dispatch = result.records[0];
    if (!dispatch) this.notFound('Dispatch request');
    try {
      await this.client.update('Dispatch_Request__c', dispatchRequestId, { Status__c: newStatus });
      if (newStatus === 'Delivered') {
        if (dispatch.Invoice_Custom__c) {
          try { await this.client.update('Invoice__c', dispatch.Invoice_Custom__c, { Status__c: 'Approved' }); } catch { /* best effort */ }
        }
        if (dispatch.Order__c) {
          try { await this.client.update('Order', dispatch.Order__c, { Status: 'Delivered' }); } catch { /* best effort */ }
        }
      }
      return this.mapDispatch({ ...dispatch, Status__c: newStatus });
    } catch (error) {
      throw this.wrap(error, 'DISPATCH_UPDATE_FAILED', 'Unable to update dispatch status.');
    }
  }

  async getSecondaryOrderGRN(context: ResolvedDistributorContext, secondaryOrderId: string): Promise<SecondaryOrderGRN> {
    this.assertSameContext(context);
    await this.assertOwnedSecondaryOrder(secondaryOrderId);
    const result = await this.rawQuery<{ Id: string; Name: string; GRN_Status__c?: string; Status__c?: string }>(
      `SELECT Id, Name, GRN_Status__c, Status__c FROM Goods_Receipt__c WHERE Order__c = '${escapeSoql(secondaryOrderId)}' AND (Order__r.AccountId = '${this.escapedAccountId}' OR Order__r.Distributor_Account__c = '${this.escapedAccountId}') ORDER BY CreatedDate DESC LIMIT 1`,
    );
    const row = result.records[0];
    if (!row) throw new SalesforceDomainError('No GRN found', 'GRN_NOT_FOUND', 'No GRN found for this secondary order.');
    return { grnId: row.Id, grnNumber: row.Name, secondaryOrderId, status: row.GRN_Status__c || row.Status__c || 'New', items: [] };
  }

  async getGoodsReceiptLines(context: ResolvedDistributorContext, orderId: string): Promise<GoodsReceiptLine[]> {
    this.assertSameContext(context);
    await this.assertOwnedOrder(orderId);
    const result = await this.rawQuery<{
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
    }>(`SELECT Id, Goods_Receipt_Note__c, Goods_Receipt_Note__r.Name, Product__c, Product__r.Name, Quantity_Ordered__c, Quantity_Received__c, Short_Quantity__c, Damage_Quantity__c, GRN_Line_Status__c, Status__c FROM GRN_Line__c WHERE Goods_Receipt_Note__r.Order__c = '${escapeSoql(orderId)}' AND (Goods_Receipt_Note__r.Order__r.AccountId = '${this.escapedAccountId}' OR Goods_Receipt_Note__r.Order__r.Distributor_Account__c = '${this.escapedAccountId}') ORDER BY Product__c, CreatedDate ASC`);
    return result.records
      .filter((row) => row.Goods_Receipt_Note__c && row.Product__c && (row.Quantity_Ordered__c || 0) > 0)
      .map((row) => ({
        lineId: row.Id,
        grnId: row.Goods_Receipt_Note__c,
        grnNumber: row.Goods_Receipt_Note__r?.Name || row.Goods_Receipt_Note__c,
        productId: row.Product__c as string,
        productName: row.Product__r?.Name || row.Product__c as string,
        orderedQuantity: row.Quantity_Ordered__c || 0,
        receivedQuantity: row.Quantity_Received__c || 0,
        lostQuantity: row.Short_Quantity__c || 0,
        damagedQuantity: row.Damage_Quantity__c || 0,
        status: row.GRN_Line_Status__c || row.Status__c,
      }));
  }

  async updateGoodsReceiptLines(
    context: ResolvedDistributorContext,
    secondaryOrderId: string,
    items: GoodsReceiptUpdate[],
  ): Promise<{ grnId: string; grnNumber: string }> {
    this.assertSameContext(context);
    this.assertWritesEnabled('update secondary GRN');
    const lines = await this.getGoodsReceiptLines(context, secondaryOrderId);
    const applied = await this.applyGoodsReceipt(lines, items);
    return { grnId: applied.grnId, grnNumber: applied.grnNumber };
  }

  async getInvoiceLineItems(
    context: ResolvedDistributorContext,
    invoiceId: string,
  ): Promise<Array<{ productId: string; productName: string; quantity: number }>> {
    this.assertSameContext(context);
    await this.getInvoiceDetails(context, invoiceId);
    const result = await this.rawQuery<{
      Product__c?: string;
      Product__r?: { Name?: string };
      Quantity__c?: number;
    }>(`SELECT Id, Product__c, Product__r.Name, Quantity__c FROM Invoice_Line_Item__c WHERE Invoice_Custom__c = '${escapeSoql(invoiceId)}' AND Product__c != null AND (Invoice_Custom__r.Billing_Account__c = '${this.escapedAccountId}' OR Invoice_Custom__r.Order__r.AccountId = '${this.escapedAccountId}' OR Invoice_Custom__r.Order__r.Distributor_Account__c = '${this.escapedAccountId}') ORDER BY CreatedDate ASC`);
    return result.records
      .filter((row) => row.Product__c && (row.Quantity__c || 0) > 0)
      .map((row) => ({
        productId: row.Product__c as string,
        productName: row.Product__r?.Name || row.Product__c as string,
        quantity: row.Quantity__c || 0,
      }));
  }

  async createGRNFromDelivery(
    context: ResolvedDistributorContext,
    orderId: string,
    invoiceId: string,
    items: Array<{ productId: string; receivedQty: number; lostQty: number; damagedQty: number }>,
  ): Promise<{ grnId: string; grnNumber: string }> {
    this.assertSameContext(context);
    this.assertWritesEnabled('record delivered order GRN');
    await Promise.all([
      this.assertOwnedSecondaryOrder(orderId),
      this.getInvoiceDetails(context, invoiceId),
    ]);
    const lines = await this.getGoodsReceiptLines(context, orderId);
    if (lines.length === 0) {
      throw new SalesforceDomainError(
        'No GRN lines found for delivery',
        'GRN_NOT_GENERATED',
        'The Goods Receipt Note for this delivery has not been generated yet. It is created automatically once the dispatch is marked Delivered — please try again shortly.',
      );
    }
    const lineByProduct = new Map(lines.map((line) => [line.productId, line]));
    const updates = items.flatMap((item) => {
      const line = lineByProduct.get(item.productId);
      return line ? [{ lineId: line.lineId, receivedQty: item.receivedQty, lostQty: item.lostQty, damagedQty: item.damagedQty }] : [];
    });
    if (updates.length === 0) {
      throw new SalesforceDomainError('No matching GRN lines', 'GRN_LINES_MISMATCH', 'None of the submitted products matched the generated GRN lines for this delivery.');
    }
    const applied = await this.applyGoodsReceipt(lines, updates);
    return { grnId: applied.grnId, grnNumber: applied.grnNumber };
  }

  async getARSConfig(context: ResolvedDistributorContext = this.context): Promise<ArsConfig> {
    this.assertSameContext(context);
    const result = await this.rawQuery<{
      MasterLabel: string;
      Default_Order_Status__c?: string;
      Include_In_Transit__c?: boolean;
      SystemModstamp?: string;
    }>('SELECT MasterLabel, Default_Order_Status__c, Include_In_Transit__c, Enable_Debug_Mode__c, SystemModstamp FROM Replenishment_Settings__mdt LIMIT 1');
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

  async updateARSStatus(context: ResolvedDistributorContext, active: boolean): Promise<ArsConfig> {
    this.assertSameContext(context);
    this.assertWritesEnabled('update ARS status');
    const batches = await this.rawQuery<{ Id: string; Status__c: string }>(
      `SELECT Id, Status__c FROM Inventory_Batch__c WHERE Distributor__c = '${this.escapedAccountId}'`,
    );
    const newStatus = active ? 'Active' : 'Inactive';
    for (const batch of batches.records) {
      if (batch.Status__c !== newStatus) await this.client.update('Inventory_Batch__c', batch.Id, { Status__c: newStatus });
    }
    return this.getARSConfig(context);
  }

  async getBatchWiseStockPolicies(context: ResolvedDistributorContext = this.context): Promise<BatchStockPolicy[]> {
    this.assertSameContext(context);
    try {
      const result = await this.rawQuery<{
        Id: string;
        Name: string;
        Product__c: string;
        Product__r?: { Name?: string };
        Expiry_Date__c: string;
        Status__c: string;
        Quantity__c?: number;
        Available_Quantity__c?: number;
        Minimum_Quantity__c?: number;
        Maximum_Quantity__c?: number;
        LastModifiedDate?: string;
      }>(`SELECT Id, Name, Product__c, Product__r.Name, Expiry_Date__c, Status__c, Quantity__c, Available_Quantity__c, Minimum_Quantity__c, Maximum_Quantity__c, LastModifiedDate FROM Inventory_Batch__c WHERE Distributor__c = '${this.escapedAccountId}' ORDER BY Expiry_Date__c ASC NULLS LAST LIMIT 50`);
      return result.records.map((row) => ({
        batchId: row.Id,
        batchNumber: row.Name,
        productId: row.Product__c,
        productName: row.Product__r?.Name || row.Product__c,
        availableStock: row.Available_Quantity__c ?? row.Quantity__c ?? 0,
        minStock: row.Minimum_Quantity__c ?? 0,
        maxStock: row.Maximum_Quantity__c ?? 0,
        expiryDate: row.Expiry_Date__c,
        replenishmentStatus: row.Status__c || 'Read-only',
        lastUpdated: row.LastModifiedDate || '',
      }));
    } catch (error) {
      // The exact inventory policy fields are a documented org capability
      // dependency. Fall back to the legacy minimal field set when absent.
      try {
        const fallback = await this.rawQuery<{
          Id: string;
          Name: string;
          Product__c: string;
          Product__r?: { Name?: string };
          Expiry_Date__c: string;
          Status__c: string;
        }>(`SELECT Id, Name, Product__c, Product__r.Name, Expiry_Date__c, Status__c FROM Inventory_Batch__c WHERE Distributor__c = '${this.escapedAccountId}' LIMIT 50`);
        return fallback.records.map((row) => ({
          batchId: row.Id,
          batchNumber: row.Name,
          productId: row.Product__c,
          productName: row.Product__r?.Name || row.Product__c,
          availableStock: 0,
          minStock: 0,
          maxStock: 0,
          expiryDate: row.Expiry_Date__c,
          replenishmentStatus: row.Status__c || 'Read-only',
          lastUpdated: '',
        }));
      } catch (fallbackError) {
        throw this.wrap(fallbackError, 'ARS_POLICIES_READ_FAILED', 'Unable to load inventory policies.');
      }
    }
  }

  async getARSTriggeredOrders(context: ResolvedDistributorContext = this.context): Promise<ArsTriggeredOrder[]> {
    this.assertSameContext(context);
    // BLK-008: no deployed org API/object currently represents triggered ARS
    // orders. Returning an empty collection preserves legacy behavior without
    // fabricating operational data.
    return [];
  }

  async applyARSPolicyChanges(
    accountId: string,
    changes: Array<{ productId: string; newMin: number; newMax: number }>,
  ): Promise<void> {
    if (accountId !== this.accountId) this.scopeDenied();
    this.assertWritesEnabled('apply ARS policy changes');
    for (const change of changes) {
      if (!change.productId || !Number.isFinite(change.newMin) || !Number.isFinite(change.newMax) || change.newMin < 0 || change.newMax < change.newMin) {
        throw new SalesforceDomainError('Invalid ARS policy', 'INVALID_ARS_POLICY', 'ARS minimum and maximum quantities are invalid.');
      }
      const productId = escapeSoql(change.productId);
      let updated = false;
      try {
        const batches = await this.rawQuery<{ Id: string }>(`SELECT Id FROM Inventory_Batch__c WHERE Distributor__c = '${this.escapedAccountId}' AND Product__c = '${productId}' LIMIT 5`);
        for (const batch of batches.records) {
          await this.client.update('Inventory_Batch__c', batch.Id, { Minimum_Quantity__c: change.newMin, Maximum_Quantity__c: change.newMax });
          updated = true;
        }
      } catch {
        // Fall through to the optional Inventory_Policy__c model.
      }
      if (!updated) {
        try {
          const policies = await this.rawQuery<{ Id: string }>(`SELECT Id FROM Inventory_Policy__c WHERE Distributor__c = '${this.escapedAccountId}' AND Product__c = '${productId}' LIMIT 1`);
          if (policies.records[0]) {
            await this.client.update('Inventory_Policy__c', policies.records[0].Id, { Minimum_Quantity__c: change.newMin, Maximum_Quantity__c: change.newMax });
            updated = true;
          }
        } catch {
          // Inventory_Policy__c is not present in every org.
        }
      }
      if (!updated) {
        throw new SalesforceDomainError('ARS policy storage unavailable', 'BLK_008', 'Salesforce does not expose a writable inventory policy for this product.');
      }
    }
  }

  async getBusinessInsightsEnhanced(context: ResolvedDistributorContext = this.context): Promise<AIBusinessInsight[]> {
    this.assertSameContext(context);
    throw this.unsupportedAi();
  }

  async getStockThresholdRecommendations(context: ResolvedDistributorContext = this.context): Promise<AIStockRecommendation[]> {
    this.assertSameContext(context);
    throw this.unsupportedAi();
  }

  async getUpsellRecommendations(context: ResolvedDistributorContext = this.context): Promise<AIUpsellRecommendation[]> {
    this.assertSameContext(context);
    throw this.unsupportedAi();
  }

  async applyStockThresholdRecommendation(
    context: ResolvedDistributorContext,
    _recommendationId: string,
  ): Promise<AIStockRecommendation> {
    this.assertSameContext(context);
    this.assertWritesEnabled('apply stock recommendation');
    throw this.unsupportedAi();
  }

  private get accountId(): string {
    return this.context.salesforceAccountId;
  }

  private get escapedAccountId(): string {
    return escapeSoql(this.accountId);
  }

  private assertSameContext(context: ResolvedDistributorContext): void {
    if (
      context.salesforceAccountId !== this.accountId
      || context.slackUserId !== this.context.slackUserId
      || context.slackTeamId !== this.context.slackTeamId
    ) {
      this.scopeDenied();
    }
  }

  private assertWritesEnabled(operation: string): void {
    if (!this.allowBusinessWrites) {
      throw new SalesforceDomainError(
        `Salesforce business write disabled: ${operation}`,
        'BUSINESS_WRITES_DISABLED',
        'This Salesforce action is disabled until the production write gate is explicitly enabled.',
      );
    }
  }

  private async rawQuery<T>(soql: string): Promise<SalesforceQueryResponse<T>> {
    return this.client.query<T>(soql);
  }

  private async rawCreate(objectName: string, fields: Record<string, unknown>): Promise<string> {
    const result = await this.client.create(objectName, fields);
    if (!result.success || !result.id) {
      throw new SalesforceDomainError(`Create ${objectName} was unsuccessful`, 'SALESFORCE_CREATE_FAILED', `Unable to create the ${objectName} record.`);
    }
    return result.id;
  }

  private async getPreferredPricebook(): Promise<{ id: string; name: string }> {
    const preferred = await this.rawQuery<{ Id: string; Name: string }>(
      "SELECT Id, Name FROM Pricebook2 WHERE IsActive = true AND Name = 'RCG PriceBook' LIMIT 1",
    );
    if (preferred.records[0]) return { id: preferred.records[0].Id, name: preferred.records[0].Name };
    const fallback = await this.rawQuery<{ Id: string; Name: string }>(
      'SELECT Id, Name FROM Pricebook2 WHERE IsActive = true AND IsStandard = true LIMIT 1',
    );
    if (fallback.records[0]) return { id: fallback.records[0].Id, name: fallback.records[0].Name };
    throw new SalesforceDomainError('No active pricebook', 'PRICEBOOK_NOT_FOUND', 'Unable to create an order because no active Salesforce pricebook was found.');
  }

  private async createOrderWithFallback(fields: Record<string, unknown>): Promise<string> {
    try {
      return await this.rawCreate('Order', fields);
    } catch (error) {
      const code = error instanceof SalesforceServerlessError ? error.code : '';
      const message = error instanceof Error ? error.message : '';
      const isSchemaError = code.includes('INVALID_FIELD')
        || code.includes('INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST')
        || message.includes('INVALID_FIELD')
        || message.includes('No such column')
        || message.includes('INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST');
      if (!isSchemaError) throw error;
      return this.rawCreate('Order', {
        AccountId: fields.AccountId,
        Pricebook2Id: fields.Pricebook2Id,
        Type: fields.Type,
        EffectiveDate: fields.EffectiveDate,
        Status: fields.Status,
        Description: fields.Description,
      });
    }
  }

  private async calculateAutoSchemeDiscount(
    quoteLines: PrimaryOrderQuote['lineItems'],
  ): Promise<{ amount: number; descriptions: string[] }> {
    const totalAmount = quoteLines.reduce((sum, line) => sum + line.totalPrice, 0);
    try {
      const result = await this.rawQuery<{
        Name: string;
        Product__c?: string;
        Product_Code__c?: string;
        Discount_Type__c?: string;
        Discount__c?: number;
        Flat_Amount__c?: number;
        CN_Amount__c?: number;
        Payout_per_Qty__c?: number;
        Min_Quantity__c?: number;
        Max_Quantity__c?: number;
        Buy_Value_From__c?: number;
        Buy_Value_To__c?: number;
      }>('SELECT Id, Name, Product__c, Product_Code__c, Product_name__c, Discount_Type__c, Discount__c, Flat_Amount__c, CN_Amount__c, Payout_per_Qty__c, Min_Quantity__c, Max_Quantity__c, Buy_Value_From__c, Buy_Value_To__c FROM Scheme_Slab_Target__c ORDER BY Discount__c DESC NULLS LAST LIMIT 200');
      let totalDiscount = 0;
      const descriptions: string[] = [];
      for (const line of quoteLines) {
        const best = result.records
          .filter((slab) => !slab.Product__c || slab.Product__c === line.productId)
          .filter((slab) => !slab.Product_Code__c || slab.Product_Code__c === line.productCode)
          .filter((slab) => !slab.Min_Quantity__c || line.quantity >= slab.Min_Quantity__c)
          .filter((slab) => !slab.Max_Quantity__c || line.quantity <= slab.Max_Quantity__c)
          .filter((slab) => !slab.Buy_Value_From__c || totalAmount >= slab.Buy_Value_From__c)
          .filter((slab) => !slab.Buy_Value_To__c || totalAmount <= slab.Buy_Value_To__c)
          .map((slab) => {
            const productSpecific = Boolean(slab.Product__c || slab.Product_Code__c);
            const discountType = (slab.Discount_Type__c || 'Percent').toLowerCase();
            const percentage = slab.Discount__c && discountType.includes('percent') ? line.totalPrice * (slab.Discount__c / 100) : 0;
            const flat = productSpecific ? slab.Flat_Amount__c || slab.CN_Amount__c || 0 : 0;
            const payout = productSpecific && slab.Payout_per_Qty__c ? slab.Payout_per_Qty__c * line.quantity : 0;
            return { slab, amount: Math.min(Math.max(percentage, flat, payout), line.totalPrice) };
          })
          .filter((candidate) => candidate.amount > 0)
          .sort((left, right) => right.amount - left.amount)[0];
        if (best) {
          totalDiscount += best.amount;
          descriptions.push(`${best.slab.Name}: ${line.productName} - Rs ${best.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
        }
      }
      return { amount: Math.min(totalDiscount, totalAmount), descriptions };
    } catch {
      return { amount: 0, descriptions: [] };
    }
  }

  private async getOrderItems(orderId: string): Promise<PrimaryOrderItemDetail[]> {
    const result = await this.rawQuery<{
      Id: string;
      Product2Id: string;
      Product2?: { Name?: string; ProductCode?: string };
      Quantity: number;
      Remaining_Qty__c?: number;
      UnitPrice: number;
      TotalPrice: number;
      Unit_Of_Measure__c?: string;
    }>(`SELECT Id, Product2Id, Product2.Name, Product2.ProductCode, Quantity, Remaining_Qty__c, UnitPrice, TotalPrice, Unit_Of_Measure__c FROM OrderItem WHERE OrderId = '${escapeSoql(orderId)}' ORDER BY CreatedDate ASC`);
    return result.records.map((row) => ({
      itemId: row.Id,
      productId: row.Product2Id,
      productName: row.Product2?.Name || row.Product2Id,
      productCode: row.Product2?.ProductCode || '',
      quantity: row.Quantity || 0,
      unitPrice: row.UnitPrice || 0,
      totalPrice: row.TotalPrice || 0,
      unitOfMeasure: row.Unit_Of_Measure__c || 'Each',
      fulfilledQuantity: row.Remaining_Qty__c != null ? Math.max(0, (row.Quantity || 0) - row.Remaining_Qty__c) : 0,
      expectedQuantity: row.Quantity || 0,
      deliveryStatus: 'Pending',
      remainingQty: row.Remaining_Qty__c,
    }));
  }

  private async getRelatedIds(objectName: string, idField: string, orderId: string): Promise<string[]> {
    assertSalesforceIdentifier(objectName);
    assertSalesforceIdentifier(idField);
    const result = await this.rawQuery<{ Id: string }>(
      `SELECT Id FROM ${objectName} WHERE ${idField} = '${escapeSoql(orderId)}' ORDER BY CreatedDate DESC LIMIT 50`,
    );
    return result.records.map((record) => record.Id);
  }

  private deriveGrnLineStatus(receivedQty: number, shortQty: number, damagedQty: number): string {
    if (receivedQty > 0 && shortQty === 0 && damagedQty === 0) return 'Fully Received';
    if (receivedQty === 0 && (shortQty > 0 || damagedQty > 0)) return 'Fully Return';
    if (receivedQty === 0 && shortQty === 0 && damagedQty === 0) return 'New';
    return 'Partially Received';
  }

  private async applyGoodsReceipt(
    lines: GoodsReceiptLineRef[],
    updates: GoodsReceiptUpdate[],
  ): Promise<{ grnId: string; grnNumber: string; headerStatus: string }> {
    this.assertWritesEnabled('apply goods receipt');
    const lineById = new Map(lines.map((line) => [line.lineId, line]));
    if (updates.length === 0) {
      throw new SalesforceDomainError('No GRN updates', 'GRN_LINES_EMPTY', 'Enter quantities for at least one GRN line.');
    }
    let grnId = '';
    let grnNumber = '';
    let allFullyReceived = true;
    let anyReceived = false;
    for (const update of updates) {
      const line = lineById.get(update.lineId);
      if (!line) {
        throw new SalesforceDomainError('Foreign GRN line', 'GRN_LINE_SCOPE_DENIED', 'A GRN line no longer belongs to this order.');
      }
      for (const quantity of [update.receivedQty, update.lostQty, update.damagedQty]) {
        if (!Number.isSafeInteger(quantity) || quantity < 0) {
          throw new SalesforceDomainError('Invalid GRN quantity', 'INVALID_GRN_QUANTITY', 'GRN quantities must be non-negative whole numbers.');
        }
      }
      const total = update.receivedQty + update.lostQty + update.damagedQty;
      if (total > line.orderedQuantity) {
        throw new SalesforceDomainError('GRN quantity exceeds order', 'GRN_QUANTITY_EXCEEDED', `For ${line.productName}, received + lost/short + damaged cannot exceed ordered quantity (${line.orderedQuantity}).`);
      }
      grnId = line.grnId;
      grnNumber = line.grnNumber;
      const status = this.deriveGrnLineStatus(update.receivedQty, update.lostQty, update.damagedQty);
      if (status !== 'Fully Received') allFullyReceived = false;
      if (update.receivedQty > 0) anyReceived = true;
      await this.client.update('GRN_Line__c', update.lineId, {
        Quantity_Received__c: update.receivedQty,
        Short_Quantity__c: update.lostQty,
        Damage_Quantity__c: update.damagedQty,
        Status__c: status,
      });
    }
    const headerStatus = allFullyReceived ? 'Full Order Received' : anyReceived ? 'Partial Order Received' : 'Full Order Return';
    if (grnId) {
      try { await this.client.update('Goods_Receipt__c', grnId, { Status__c: headerStatus }); } catch { /* line updates are authoritative */ }
    }
    return { grnId, grnNumber, headerStatus };
  }

  private async getShippingAddress(accountId: string): Promise<string> {
    try {
      const result = await this.rawQuery<{
        ShippingStreet?: string;
        ShippingCity?: string;
        ShippingState?: string;
        ShippingPostalCode?: string;
      }>(`SELECT ShippingStreet, ShippingCity, ShippingState, ShippingPostalCode FROM Account WHERE Id = '${escapeSoql(accountId)}' LIMIT 1`);
      const row = result.records[0];
      return row ? [row.ShippingStreet, row.ShippingCity, row.ShippingState, row.ShippingPostalCode].filter(Boolean).join(', ') : '';
    } catch {
      return '';
    }
  }

  private async lookupAccountName(accountId: string): Promise<string> {
    try {
      const result = await this.rawQuery<{ Name: string }>(`SELECT Name FROM Account WHERE Id = '${escapeSoql(accountId)}' LIMIT 1`);
      return result.records[0]?.Name || 'Unknown Retailer';
    } catch {
      return 'Unknown Retailer';
    }
  }

  private async getProductInventory(productIds: string[]): Promise<Map<string, {
    qty: number;
    batches: Array<{ batchId: string; quantity: number; expiryDate?: string; objectName: 'Inventory__c' | 'Inventory_Batch__c' }>;
  }>> {
    const inventory = new Map<string, {
      qty: number;
      batches: Array<{ batchId: string; quantity: number; expiryDate?: string; objectName: 'Inventory__c' | 'Inventory_Batch__c' }>;
    }>();
    if (productIds.length === 0) return inventory;
    const productList = [...new Set(productIds)].map((id) => `'${escapeSoql(id)}'`).join(',');
    interface InventoryRow {
      Id: string;
      Product__c: string;
      Quantity_Available__c?: number;
      Total_Quantity__c?: number;
      Quantity__c?: number;
      Available_Quantity__c?: number;
      Expiry_Date__c?: string;
    }
    let rows: InventoryRow[] = [];
    let quantity: (row: InventoryRow) => number = (row) => row.Quantity_Available__c || 0;
    let objectName: 'Inventory__c' | 'Inventory_Batch__c' = 'Inventory__c';
    try {
      const result = await this.rawQuery<InventoryRow>(`SELECT Id, Product__c, Quantity_Available__c, Expiry_Date__c FROM Inventory__c WHERE Account__c = '${this.escapedAccountId}' AND Product__c IN (${productList})`);
      rows = result.records;
    } catch {
      try {
        const result = await this.rawQuery<InventoryRow>(`SELECT Id, Product__c, Total_Quantity__c, Expiry_Date__c FROM Inventory__c WHERE Account__c = '${this.escapedAccountId}' AND Product__c IN (${productList})`);
        rows = result.records;
        quantity = (row) => row.Total_Quantity__c || 0;
      } catch {
        try {
          const result = await this.rawQuery<InventoryRow>(`SELECT Id, Product__c, Quantity__c, Available_Quantity__c, Expiry_Date__c FROM Inventory_Batch__c WHERE Distributor__c = '${this.escapedAccountId}' AND Product__c IN (${productList}) ORDER BY Expiry_Date__c ASC NULLS LAST`);
          rows = result.records;
          quantity = (row) => row.Available_Quantity__c ?? row.Quantity__c ?? 0;
          objectName = 'Inventory_Batch__c';
        } catch {
          return inventory;
        }
      }
    }
    for (const row of rows) {
      const amount = quantity(row);
      const existing = inventory.get(row.Product__c) ?? { qty: 0, batches: [] };
      existing.qty += amount;
      existing.batches.push({ batchId: row.Id, quantity: amount, expiryDate: row.Expiry_Date__c, objectName });
      inventory.set(row.Product__c, existing);
    }
    return inventory;
  }

  private async getFulfilledQtyByProduct(orderId: string): Promise<Map<string, number>> {
    const fulfilled = new Map<string, number>();
    try {
      const result = await this.rawQuery<{ Product__c: string; totalQty: number }>(
        `SELECT Product__c, SUM(Quantity__c) totalQty FROM Invoice_Line_Item__c WHERE Invoice_Custom__r.Order__c = '${escapeSoql(orderId)}' AND (Invoice_Custom__r.Order__r.AccountId = '${this.escapedAccountId}' OR Invoice_Custom__r.Order__r.Distributor_Account__c = '${this.escapedAccountId}') GROUP BY Product__c`,
      );
      for (const row of result.records) fulfilled.set(row.Product__c, row.totalQty || 0);
    } catch {
      // Object fields differ across org variants; treat as not fulfilled.
    }
    return fulfilled;
  }

  private mapDispatch(row: {
    Id: string;
    Dispatch_Request_Name__c?: string;
    Order__c?: string;
    Status__c: string;
    Invoice_Custom__c?: string;
    Start_Date__c?: string;
    End_Date__c?: string;
    Source_Address__c?: string;
    Destination_Address__c?: string;
  }): DispatchRequest {
    return {
      dispatchId: row.Id,
      dispatchName: row.Dispatch_Request_Name__c || row.Id,
      orderId: row.Order__c,
      status: row.Status__c,
      invoiceId: row.Invoice_Custom__c,
      startDate: row.Start_Date__c,
      endDate: row.End_Date__c,
      sourceAddress: row.Source_Address__c,
      destinationAddress: row.Destination_Address__c,
    };
  }

  private async assertOwnedOrder(orderId: string): Promise<void> {
    const result = await this.rawQuery<{ Id: string }>(
      `SELECT Id FROM Order WHERE Id = '${escapeSoql(orderId)}' AND (AccountId = '${this.escapedAccountId}' OR Distributor_Account__c = '${this.escapedAccountId}') LIMIT 1`,
    );
    if (!result.records[0]) this.scopeDenied();
  }

  private async assertOwnedSecondaryOrder(orderId: string): Promise<void> {
    const result = await this.rawQuery<{ Id: string }>(
      `SELECT Id FROM Order WHERE Id = '${escapeSoql(orderId)}' AND (AccountId = '${this.escapedAccountId}' OR Distributor_Account__c = '${this.escapedAccountId}') AND Type = 'Secondary' LIMIT 1`,
    );
    if (!result.records[0]) this.scopeDenied();
  }

  private async assertOwnedRecord(objectName: string, id: string): Promise<void> {
    this.assertSupportedObjectName(objectName);
    const escapedId = escapeSoql(id);
    let soql: string;
    switch (objectName) {
      case 'Order':
        soql = `SELECT Id FROM Order WHERE Id = '${escapedId}' AND (AccountId = '${this.escapedAccountId}' OR Distributor_Account__c = '${this.escapedAccountId}') LIMIT 1`;
        break;
      case 'OrderItem':
        soql = `SELECT Id FROM OrderItem WHERE Id = '${escapedId}' AND (Order.AccountId = '${this.escapedAccountId}' OR Order.Distributor_Account__c = '${this.escapedAccountId}') LIMIT 1`;
        break;
      case 'Return_Order__c':
        soql = `SELECT Id FROM Return_Order__c WHERE Id = '${escapedId}' AND Account__c = '${this.escapedAccountId}' LIMIT 1`;
        break;
      case 'Claim__c':
        soql = `SELECT Id FROM Claim__c WHERE Id = '${escapedId}' AND (Retailer_Account__c = '${this.escapedAccountId}' OR Order__r.AccountId = '${this.escapedAccountId}' OR Order__r.Distributor_Account__c = '${this.escapedAccountId}' OR Return_Order__r.Account__c = '${this.escapedAccountId}') LIMIT 1`;
        break;
      case 'Credit_Note__c':
      case 'Credit_Note_Usage__c':
        soql = `SELECT Id FROM ${objectName} WHERE Id = '${escapedId}' AND Account__c = '${this.escapedAccountId}' LIMIT 1`;
        break;
      case 'Invoice__c':
        soql = `SELECT Id FROM Invoice__c WHERE Id = '${escapedId}' AND (Billing_Account__c = '${this.escapedAccountId}' OR Order__r.AccountId = '${this.escapedAccountId}' OR Order__r.Distributor_Account__c = '${this.escapedAccountId}') LIMIT 1`;
        break;
      case 'Invoice_Line_Item__c':
        soql = `SELECT Id FROM Invoice_Line_Item__c WHERE Id = '${escapedId}' AND (Invoice_Custom__r.Billing_Account__c = '${this.escapedAccountId}' OR Invoice_Custom__r.Order__r.AccountId = '${this.escapedAccountId}' OR Invoice_Custom__r.Order__r.Distributor_Account__c = '${this.escapedAccountId}') LIMIT 1`;
        break;
      case 'Dispatch_Request__c':
        soql = `SELECT Id FROM Dispatch_Request__c WHERE Id = '${escapedId}' AND (Order__r.AccountId = '${this.escapedAccountId}' OR Order__r.Distributor_Account__c = '${this.escapedAccountId}') LIMIT 1`;
        break;
      case 'Goods_Receipt__c':
        soql = `SELECT Id FROM Goods_Receipt__c WHERE Id = '${escapedId}' AND (Order__r.AccountId = '${this.escapedAccountId}' OR Order__r.Distributor_Account__c = '${this.escapedAccountId}') LIMIT 1`;
        break;
      case 'GRN_Line__c':
        soql = `SELECT Id FROM GRN_Line__c WHERE Id = '${escapedId}' AND (Goods_Receipt_Note__r.Order__r.AccountId = '${this.escapedAccountId}' OR Goods_Receipt_Note__r.Order__r.Distributor_Account__c = '${this.escapedAccountId}') LIMIT 1`;
        break;
      case 'Inventory__c':
        soql = `SELECT Id FROM Inventory__c WHERE Id = '${escapedId}' AND Account__c = '${this.escapedAccountId}' LIMIT 1`;
        break;
      case 'Inventory_Batch__c':
      case 'Inventory_Policy__c':
        soql = `SELECT Id FROM ${objectName} WHERE Id = '${escapedId}' AND Distributor__c = '${this.escapedAccountId}' LIMIT 1`;
        break;
      default:
        throw new SalesforceDomainError(`Unsupported scoped object: ${objectName}`, 'UNSUPPORTED_SCOPED_OBJECT', 'This record type cannot be accessed from Slack.');
    }
    const result = await this.rawQuery<{ Id: string }>(soql);
    if (!result.records[0]) this.scopeDenied();
  }

  private async assertCreateOwnership(objectName: string, fields: Record<string, unknown>): Promise<void> {
    const equalsAccount = (fieldName: string): boolean => fields[fieldName] === this.accountId;
    switch (objectName) {
      case 'Order':
        if (!equalsAccount('AccountId') && !equalsAccount('Distributor_Account__c')) this.scopeDenied();
        return;
      case 'OrderItem':
        if (typeof fields.OrderId !== 'string') this.scopeDenied();
        return this.assertOwnedRecord('Order', fields.OrderId);
      case 'Return_Order__c':
        if (!equalsAccount('Account__c')) this.scopeDenied();
        return;
      case 'Claim__c':
        if (!equalsAccount('Retailer_Account__c')) this.scopeDenied();
        if (typeof fields.Return_Order__c === 'string') await this.assertOwnedRecord('Return_Order__c', fields.Return_Order__c);
        if (typeof fields.Order__c === 'string') await this.assertOwnedRecord('Order', fields.Order__c);
        return;
      case 'Credit_Note_Usage__c':
        if (!equalsAccount('Account__c') || typeof fields.Order__c !== 'string') this.scopeDenied();
        return this.assertOwnedRecord('Order', fields.Order__c);
      case 'Invoice__c':
        if (!equalsAccount('Billing_Account__c') || typeof fields.Order__c !== 'string') this.scopeDenied();
        return this.assertOwnedSecondaryOrder(fields.Order__c);
      case 'Invoice_Line_Item__c':
        if (typeof fields.Invoice_Custom__c !== 'string') this.scopeDenied();
        return this.assertOwnedRecord('Invoice__c', fields.Invoice_Custom__c);
      case 'Dispatch_Request__c':
        if (typeof fields.Order__c !== 'string') this.scopeDenied();
        await this.assertOwnedSecondaryOrder(fields.Order__c);
        if (typeof fields.Invoice_Custom__c === 'string') await this.assertOwnedRecord('Invoice__c', fields.Invoice_Custom__c);
        return;
      case 'Goods_Receipt__c':
        if (typeof fields.Order__c !== 'string') this.scopeDenied();
        return this.assertOwnedRecord('Order', fields.Order__c);
      case 'GRN_Line__c':
        if (typeof fields.Goods_Receipt_Note__c !== 'string') this.scopeDenied();
        return this.assertOwnedRecord('Goods_Receipt__c', fields.Goods_Receipt_Note__c);
      case 'Inventory__c':
        if (!equalsAccount('Account__c')) this.scopeDenied();
        return;
      case 'Inventory_Batch__c':
      case 'Inventory_Policy__c':
        if (!equalsAccount('Distributor__c')) this.scopeDenied();
        return;
      default:
        throw new SalesforceDomainError(`Unsupported scoped create: ${objectName}`, 'UNSUPPORTED_SCOPED_CREATE', 'This record type cannot be created from Slack.');
    }
  }

  private async assertAnyOwnedBusinessRecord(recordId: string): Promise<void> {
    for (const objectName of ['Order', 'Return_Order__c', 'Claim__c', 'Invoice__c', 'Dispatch_Request__c', 'Goods_Receipt__c']) {
      try {
        await this.assertOwnedRecord(objectName, recordId);
        return;
      } catch (error) {
        if (!(error instanceof SalesforceDomainError) || error.code !== 'ACCOUNT_SCOPE_DENIED') throw error;
      }
    }
    this.scopeDenied();
  }

  private assertSafeGenericQuery(soql: string): void {
    const objectMatches = [...soql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z][A-Za-z0-9_]*)/gi)].map((match) => match[1]);
    if (objectMatches.length === 0) {
      throw new SalesforceDomainError('SOQL has no object', 'INVALID_SOQL', 'Unable to retrieve Salesforce data.');
    }
    for (const objectName of objectMatches) assertSalesforceIdentifier(objectName);
    if (objectMatches.every((objectName) => GLOBAL_READ_OBJECTS.has(objectName))) return;
    if (!soql.includes(this.accountId) && !soql.includes(this.escapedAccountId)) {
      throw new SalesforceDomainError('Generic SOQL lacks account scope', 'UNSCOPED_SOQL', 'This Salesforce query is not scoped to your distributor account.');
    }
  }

  private assertSupportedObjectName(objectName: string): void {
    assertSalesforceIdentifier(objectName);
    if (!DESCRIBE_OBJECTS.has(objectName)) {
      throw new SalesforceDomainError(`Unsupported object: ${objectName}`, 'UNSUPPORTED_SALESFORCE_OBJECT', 'This Salesforce record type is not available from Slack.');
    }
  }

  private unsupportedAi(): SalesforceDomainError {
    return new SalesforceDomainError(
      'AI insights are not available through the Salesforce REST model (BLK-009)',
      'BLK_009',
      'AI recommendations are not available from the current Salesforce APIs.',
    );
  }

  private scopeDenied(): never {
    throw new SalesforceDomainError('Record is outside the resolved account scope', 'ACCOUNT_SCOPE_DENIED', 'This record is not available for your distributor account.');
  }

  private notFound(label: string): never {
    throw new SalesforceDomainError(`${label} was not found in the resolved account`, 'RECORD_NOT_FOUND', `${label} was not found or is not available for your distributor account.`);
  }

  private wrap(error: unknown, code: string, userMessage: string): SalesforceDomainError {
    if (error instanceof SalesforceDomainError) return error;
    return new SalesforceDomainError(
      error instanceof Error ? error.message : code,
      code,
      userMessage,
      { cause: error },
    );
  }
}

export interface BoundSalesforceDomain {
  isMock(): false;
  query<T = SalesforceRecord>(soql: string): Promise<SalesforceQueryResponse<T>>;
  queryAll<T = SalesforceRecord>(soql: string): Promise<SalesforceQueryResponse<T>>;
  create(objectName: string, fields: Record<string, unknown>): Promise<string>;
  update(objectName: string, id: string, fields: Record<string, unknown>): Promise<void>;
  delete(objectName: string, id: string): Promise<void>;
  describe(objectName: string): Promise<SalesforceDescribeResult>;
  getRecord<T = SalesforceRecord>(objectName: string, id: string, fields?: string[]): Promise<T>;
  getAvailableProducts(): Promise<DMSProduct[]>;
  calculatePrimaryOrderQuote(lineItems: Array<{ productId: string; quantity: number; schemeDiscount?: number }>, creditNoteIds?: string[]): Promise<PrimaryOrderQuote>;
  createPrimaryOrder(quote: PrimaryOrderQuote): Promise<PrimaryOrder>;
  getPrimaryOrders(): Promise<PrimaryOrder[]>;
  getPrimaryOrderDetails(orderId: string): Promise<PrimaryOrderDetail>;
  markPrimaryOrderDelivered(orderId: string): Promise<void>;
  createOrUpdateGRN(orderId: string, payload: GRNPayload): Promise<GRNResult>;
  getGRNDetails(grnId: string): Promise<GRNResult>;
  getReturnOrders(): Promise<ReturnOrder[]>;
  getReturnOrderDetails(returnOrderId: string): Promise<ReturnOrderDetail>;
  getClaims(returnOrderId?: string): Promise<Claim[]>;
  createOrUpdateClaim(payload: ClaimPayload): Promise<Claim>;
  uploadFileToRecord(recordId: string, payload: FileUploadPayload): Promise<FileUploadResult>;
  submitForApproval(recordId: string, objectName: string): Promise<ApprovalResult>;
  getApprovalStatus(recordId: string, objectName: string): Promise<ApprovalStatus>;
  getCreditNotes(returnOrderId?: string): Promise<CreditNote[]>;
  getSecondaryOrders(): Promise<SecondaryOrder[]>;
  getSecondaryOrderDetails(orderId: string): Promise<SecondaryOrderDetail>;
  getInventoryAvailability(orderId: string): Promise<InventoryAvailability[]>;
  createInvoice(orderId: string, payload: InvoicePayload): Promise<DMSInvoice>;
  getInvoiceDetails(invoiceId: string): Promise<DMSInvoice>;
  getDispatchRequests(orderId: string): Promise<DispatchRequest[]>;
  updateDispatchStatus(dispatchId: string, status: string): Promise<DispatchRequest>;
  getSecondaryOrderGRN(orderId: string): Promise<SecondaryOrderGRN>;
  getGoodsReceiptLines(orderId: string): Promise<GoodsReceiptLine[]>;
  updateGoodsReceiptLines(orderId: string, items: GoodsReceiptUpdate[]): Promise<{ grnId: string; grnNumber: string }>;
  getInvoiceLineItems(invoiceId: string): Promise<Array<{ productId: string; productName: string; quantity: number }>>;
  createGRNFromDelivery(orderId: string, invoiceId: string, items: Array<{ productId: string; receivedQty: number; lostQty: number; damagedQty: number }>): Promise<{ grnId: string; grnNumber: string }>;
  getARSConfig(): Promise<ArsConfig>;
  updateARSStatus(active: boolean): Promise<ArsConfig>;
  getBatchWiseStockPolicies(): Promise<BatchStockPolicy[]>;
  getARSTriggeredOrders(): Promise<ArsTriggeredOrder[]>;
  applyARSPolicyChanges(changes: Array<{ productId: string; newMin: number; newMax: number }>): Promise<void>;
  getBusinessInsightsEnhanced(): Promise<AIBusinessInsight[]>;
  getStockThresholdRecommendations(): Promise<AIStockRecommendation[]>;
  getUpsellRecommendations(): Promise<AIUpsellRecommendation[]>;
  applyStockThresholdRecommendation(recommendationId: string): Promise<AIStockRecommendation>;
}

class AccountBoundSalesforceDomain implements BoundSalesforceDomain {
  constructor(
    private readonly context: ResolvedDistributorContext,
    private readonly domain: SalesforceDomain,
  ) {}

  isMock(): false { return false; }
  query<T = SalesforceRecord>(soql: string): Promise<SalesforceQueryResponse<T>> { return this.domain.query<T>(soql); }
  queryAll<T = SalesforceRecord>(soql: string): Promise<SalesforceQueryResponse<T>> { return this.domain.queryAll<T>(soql); }
  create(objectName: string, fields: Record<string, unknown>): Promise<string> { return this.domain.create(objectName, fields); }
  update(objectName: string, id: string, fields: Record<string, unknown>): Promise<void> { return this.domain.update(objectName, id, fields); }
  delete(objectName: string, id: string): Promise<void> { return this.domain.delete(objectName, id); }
  describe(objectName: string): Promise<SalesforceDescribeResult> { return this.domain.describe(objectName); }
  getRecord<T = SalesforceRecord>(objectName: string, id: string, fields?: string[]): Promise<T> { return this.domain.getRecord<T>(objectName, id, fields); }
  getAvailableProducts(): Promise<DMSProduct[]> { return this.domain.getAvailableProducts(this.context); }
  calculatePrimaryOrderQuote(lineItems: Array<{ productId: string; quantity: number; schemeDiscount?: number }>, creditNoteIds: string[] = []): Promise<PrimaryOrderQuote> { return this.domain.calculatePrimaryOrderQuote(this.context, lineItems, creditNoteIds); }
  createPrimaryOrder(quote: PrimaryOrderQuote): Promise<PrimaryOrder> { return this.domain.createPrimaryOrder(this.context, quote); }
  getPrimaryOrders(): Promise<PrimaryOrder[]> { return this.domain.getPrimaryOrders(this.context); }
  getPrimaryOrderDetails(orderId: string): Promise<PrimaryOrderDetail> { return this.domain.getPrimaryOrderDetails(this.context, orderId); }
  markPrimaryOrderDelivered(orderId: string): Promise<void> { return this.domain.markPrimaryOrderDelivered(this.context, orderId); }
  createOrUpdateGRN(orderId: string, payload: GRNPayload): Promise<GRNResult> { return this.domain.createOrUpdateGRN(this.context, orderId, payload); }
  getGRNDetails(grnId: string): Promise<GRNResult> { return this.domain.getGRNDetails(this.context, grnId); }
  getReturnOrders(): Promise<ReturnOrder[]> { return this.domain.getReturnOrders(this.context); }
  getReturnOrderDetails(returnOrderId: string): Promise<ReturnOrderDetail> { return this.domain.getReturnOrderDetails(this.context, returnOrderId); }
  getClaims(returnOrderId?: string): Promise<Claim[]> { return this.domain.getClaims(this.context, returnOrderId); }
  createOrUpdateClaim(payload: ClaimPayload): Promise<Claim> { return this.domain.createOrUpdateClaim(this.context, payload); }
  uploadFileToRecord(recordId: string, payload: FileUploadPayload): Promise<FileUploadResult> { return this.domain.uploadFileToRecord(this.context, recordId, payload); }
  submitForApproval(recordId: string, objectName: string): Promise<ApprovalResult> { return this.domain.submitForApproval(this.context, recordId, objectName); }
  getApprovalStatus(recordId: string, objectName: string): Promise<ApprovalStatus> { return this.domain.getApprovalStatus(this.context, recordId, objectName); }
  getCreditNotes(returnOrderId?: string): Promise<CreditNote[]> { return this.domain.getCreditNotes(this.context, returnOrderId); }
  getSecondaryOrders(): Promise<SecondaryOrder[]> { return this.domain.getSecondaryOrders(this.context); }
  getSecondaryOrderDetails(orderId: string): Promise<SecondaryOrderDetail> { return this.domain.getSecondaryOrderDetails(this.context, orderId); }
  getInventoryAvailability(orderId: string): Promise<InventoryAvailability[]> { return this.domain.getInventoryAvailability(this.context, orderId); }
  createInvoice(orderId: string, payload: InvoicePayload): Promise<DMSInvoice> { return this.domain.createInvoice(this.context, orderId, payload); }
  getInvoiceDetails(invoiceId: string): Promise<DMSInvoice> { return this.domain.getInvoiceDetails(this.context, invoiceId); }
  getDispatchRequests(orderId: string): Promise<DispatchRequest[]> { return this.domain.getDispatchRequests(this.context, orderId); }
  updateDispatchStatus(dispatchId: string, status: string): Promise<DispatchRequest> { return this.domain.updateDispatchStatus(this.context, dispatchId, status); }
  getSecondaryOrderGRN(orderId: string): Promise<SecondaryOrderGRN> { return this.domain.getSecondaryOrderGRN(this.context, orderId); }
  getGoodsReceiptLines(orderId: string): Promise<GoodsReceiptLine[]> { return this.domain.getGoodsReceiptLines(this.context, orderId); }
  updateGoodsReceiptLines(orderId: string, items: GoodsReceiptUpdate[]): Promise<{ grnId: string; grnNumber: string }> { return this.domain.updateGoodsReceiptLines(this.context, orderId, items); }
  getInvoiceLineItems(invoiceId: string): Promise<Array<{ productId: string; productName: string; quantity: number }>> { return this.domain.getInvoiceLineItems(this.context, invoiceId); }
  createGRNFromDelivery(orderId: string, invoiceId: string, items: Array<{ productId: string; receivedQty: number; lostQty: number; damagedQty: number }>): Promise<{ grnId: string; grnNumber: string }> { return this.domain.createGRNFromDelivery(this.context, orderId, invoiceId, items); }
  getARSConfig(): Promise<ArsConfig> { return this.domain.getARSConfig(this.context); }
  updateARSStatus(active: boolean): Promise<ArsConfig> { return this.domain.updateARSStatus(this.context, active); }
  getBatchWiseStockPolicies(): Promise<BatchStockPolicy[]> { return this.domain.getBatchWiseStockPolicies(this.context); }
  getARSTriggeredOrders(): Promise<ArsTriggeredOrder[]> { return this.domain.getARSTriggeredOrders(this.context); }
  applyARSPolicyChanges(changes: Array<{ productId: string; newMin: number; newMax: number }>): Promise<void> { return this.domain.applyARSPolicyChanges(this.context.salesforceAccountId, changes); }
  getBusinessInsightsEnhanced(): Promise<AIBusinessInsight[]> { return this.domain.getBusinessInsightsEnhanced(this.context); }
  getStockThresholdRecommendations(): Promise<AIStockRecommendation[]> { return this.domain.getStockThresholdRecommendations(this.context); }
  getUpsellRecommendations(): Promise<AIUpsellRecommendation[]> { return this.domain.getUpsellRecommendations(this.context); }
  applyStockThresholdRecommendation(recommendationId: string): Promise<AIStockRecommendation> { return this.domain.applyStockThresholdRecommendation(this.context, recommendationId); }
}

/** Create the only account-bound Salesforce surface Convex handlers should use. */
export function createSalesforceDomain(
  context: ResolvedDistributorContext,
  options: SalesforceDomainOptions = {},
): BoundSalesforceDomain {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  const allowBusinessWrites = options.allowBusinessWrites
    ?? runtimeEnv.ALLOW_LIVE_BUSINESS_WRITES_FROM_SLACK === 'true';
  const domain = new SalesforceDomain(
    context,
    options.client ?? createSalesforceServerlessClient(),
    allowBusinessWrites,
    options.now,
  );
  return new AccountBoundSalesforceDomain(context, domain);
}

export function escapeSoql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function assertSalesforceIdentifier(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new SalesforceDomainError('Invalid Salesforce identifier', 'INVALID_SALESFORCE_IDENTIFIER', 'Unable to access this Salesforce record type.');
  }
}
