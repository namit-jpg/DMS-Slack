import {
  ISalesforceClient, SalesforceQueryResult, SalesforceDescribeResult, SalesforceRecord,
  ResolvedDistributorContext, DMSProduct, PrimaryOrderQuote, PrimaryOrder, PrimaryOrderDetail,
  GRNPayload, GRNResult, ReturnOrder, ReturnOrderDetail, Claim, ClaimPayload,
  FileUploadPayload, FileUploadResult, ApprovalResult, ApprovalStatus, CreditNote,
  SecondaryOrder, SecondaryOrderDetail, InventoryAvailability, InvoicePayload, DMSInvoice,
  DispatchRequest, SecondaryOrderGRN, ArsConfig, ArsTriggeredOrder, BatchStockPolicy,
  AIBusinessInsight, AIStockRecommendation, AIUpsellRecommendation,
} from './types';

const MOCK_ACCOUNTS: SalesforceRecord[] = [
  { Id: '001MOCK000000001', Name: 'Demo Distributors Ltd', Type: 'Partner', IsPartner: true, Email__c: 'distributor@demo.com', Business_Type__c: 'Distributor' },
  { Id: '001MOCK000000002', Name: 'Mega Retail Corp', Type: 'Channel Partner', IsPartner: true, Email__c: 'mega@demo.com', Business_Type__c: 'Distributor' },
  { Id: '001MOCK000000003', Name: 'QuickTrade Distributors', Type: 'Partner', IsPartner: true, Email__c: 'quicktrade@demo.com', Business_Type__c: 'Distributor' },
  { Id: '001MOCK000000004', Name: 'Duplicate Distro A', Type: 'Partner', IsPartner: true, Email__c: 'duplicate@demo.com', Business_Type__c: 'Distributor' },
  { Id: '001MOCK000000005', Name: 'Duplicate Distro B', Type: 'Partner', IsPartner: true, Email__c: 'duplicate@demo.com', Business_Type__c: 'Distributor' },
  { Id: '001MOCK000000006', Name: 'Inactive Distributor Corp', Type: 'Partner', IsPartner: true, Email__c: 'inactive@demo.com', Business_Type__c: 'Distributor' },
];

const MOCK_CONTACTS: SalesforceRecord[] = [
  { Id: '003MOCK000000001', Email: 'distributor@demo.com', FirstName: 'John', LastName: 'Doe', AccountId: '001MOCK000000001', Distributor__c: '001MOCK000000001' },
  { Id: '003MOCK000000002', Email: 'mega@demo.com', FirstName: 'Jane', LastName: 'Smith', AccountId: '001MOCK000000002', Distributor__c: '001MOCK000000002' },
  { Id: '003MOCK000000003', Email: 'quicktrade@demo.com', FirstName: 'Bob', LastName: 'Johnson', AccountId: '001MOCK000000003', Distributor__c: '001MOCK000000003' },
  { Id: '003MOCK000000004', Email: 'inactive@demo.com', FirstName: 'Inactive', LastName: 'User', AccountId: '001MOCK000000006', Distributor__c: '001MOCK000000006' },
];

const MOCK_PRODUCTS: SalesforceRecord[] = [
  { Id: '01tMOCK000000001', Name: 'Beverage Pack A', ProductCode: 'BEV-A-001', Family: 'Beverages', IsActive: true, Unit_Of_Measure__c: 'Case', Unit_Price__c: 125.50, Brand_Name__c: 'FreshDrink', Pack_Size__c: 24, Minimum_Order_Quantity_Primary__c: 5, Product_Category__c: 'Beverage' },
  { Id: '01tMOCK000000002', Name: 'Snack Box B', ProductCode: 'SNK-B-002', Family: 'Snacks', IsActive: true, Unit_Of_Measure__c: 'Box', Unit_Price__c: 89.00, Brand_Name__c: 'CrunchCo', Pack_Size__c: 12, Minimum_Order_Quantity_Primary__c: 10, Product_Category__c: 'Snack' },
  { Id: '01tMOCK000000003', Name: 'Dairy Pack C', ProductCode: 'DRY-C-003', Family: 'Dairy', IsActive: true, Unit_Of_Measure__c: 'Crate', Unit_Price__c: 210.00, Brand_Name__c: 'PureDairy', Pack_Size__c: 6, Minimum_Order_Quantity_Primary__c: 3, Product_Category__c: 'Dairy' },
  { Id: '01tMOCK000000004', Name: 'Oil Can D', ProductCode: 'OIL-D-004', Family: 'Oils', IsActive: true, Unit_Of_Measure__c: 'Can', Unit_Price__c: 350.75, Brand_Name__c: 'GoldCook', Pack_Size__c: 4, Minimum_Order_Quantity_Primary__c: 2, Product_Category__c: 'Oil' },
  { Id: '01tMOCK000000005', Name: 'Spice Mix E', ProductCode: 'SPC-E-005', Family: 'Spices', IsActive: true, Unit_Of_Measure__c: 'Packet', Unit_Price__c: 45.25, Brand_Name__c: 'FlavorHouse', Pack_Size__c: 50, Minimum_Order_Quantity_Primary__c: 20, Product_Category__c: 'Spice' },
];

const MOCK_PURCHASE_ORDERS: SalesforceRecord[] = [
  { Id: 'a01MOCK000000001', Name: 'PO-2026-0001', Distributor__c: '001MOCK000000001', Status__c: 'Approved', Total_Amount__c: 12500.00, Scheme_Discount__c: 1250.00, Discount_Amount__c: 500.00, Grand_Total__c: 10750.00, Tax_Amount__c: 0, Order_Date__c: '2026-05-01', Approval_Status__c: 'Approved', Fulfillment_Status__c: 'Partially Fulfilled' },
  { Id: 'a01MOCK000000002', Name: 'PO-2026-0002', Distributor__c: '001MOCK000000001', Status__c: 'Pending', Total_Amount__c: 8900.00, Scheme_Discount__c: 0, Discount_Amount__c: 200.00, Grand_Total__c: 8700.00, Tax_Amount__c: 0, Order_Date__c: '2026-05-02', Approval_Status__c: 'Pending', Fulfillment_Status__c: 'Not Fulfilled' },
];

const MOCK_RETURN_ORDERS: SalesforceRecord[] = [
  { Id: 'a02MOCK000000001', Name: 'RO-2026-0001', Account__c: '001MOCK000000001', Status__c: 'Approved', Grand_Total__c: 1500.00, Order__c: 'a01MOCK000000001', Type__c: 'Damaged', Description__c: 'Damaged Beverage Pack A - 10 units', Approval_Status__c: 'Approved', Goods_Receipt_Note__c: 'grnMOCK000000001' },
];

const MOCK_INVOICES: SalesforceRecord[] = [
  { Id: 'a03MOCK000000001', Name: 'INV-2026-0001', Billing_Account__c: '001MOCK000000001', Status__c: 'Paid', Total_Amount__c: 12500.00, Invoice_Date__c: '2026-05-01', Payment_Status__c: 'Paid', Type__c: 'Full' },
  { Id: 'a03MOCK000000002', Name: 'INV-2026-0002', Billing_Account__c: '001MOCK000000001', Status__c: 'Pending', Total_Amount__c: 8900.00, Invoice_Date__c: '2026-05-02', Payment_Status__c: 'Unpaid', Type__c: 'Full' },
];

const MOCK_CREDIT_NOTES: SalesforceRecord[] = [
  { Id: 'cnMOCK000000001', Name: 'CN-2026-0001', Account__c: '001MOCK000000001', Status__c: 'Issued', Amount__c: 1500.00, Return_Order__c: 'a02MOCK000000001' },
];

const MOCK_SECONDARY_ORDERS: SalesforceRecord[] = [
  { Id: 'soMOCK000000001', Name: 'SO-2026-0001', Distributor__c: '001MOCK000000001', Status__c: 'Pending', Total_Amount__c: 4500.00, Fulfillment_Status__c: 'Not Fulfilled', Invoice_Status__c: 'Not Invoiced', Dispatch_Status__c: 'Not Dispatched', Order_Date__c: '2026-05-03', Retailer_Customer__c: 'Wakanda General Store', Requested_Delivery_Date__c: '2026-05-10' },
  { Id: 'soMOCK000000002', Name: 'SO-2026-0002', Distributor__c: '001MOCK000000001', Status__c: 'Processing', Total_Amount__c: 8200.00, Fulfillment_Status__c: 'Partially Fulfilled', Invoice_Status__c: 'Invoiced', Dispatch_Status__c: 'Pending', Order_Date__c: '2026-05-04', Retailer_Customer__c: 'Gotham Mart', Requested_Delivery_Date__c: '2026-05-12' },
];

const mockOrders = new Map<string, SalesforceRecord[]>();
const mockGRNs = new Map<string, SalesforceRecord[]>();
const mockReturnOrders = new Map<string, SalesforceRecord[]>();
const mockClaims = new Map<string, SalesforceRecord[]>();
const mockCreditNotes = new Map<string, SalesforceRecord[]>();
let mockFileCounter = 0;

export class MockSalesforceClient implements ISalesforceClient {
  private records: Map<string, SalesforceRecord[]> = new Map();
  private objectFields: Map<string, string[]> = new Map();

  constructor() {
    this.seedData();
  }

  isMock(): boolean { return true; }

  async query<T = SalesforceRecord>(soql: string): Promise<SalesforceQueryResult<T>> { return this.simulateQuery<T>(soql); }
  async queryAll<T = SalesforceRecord>(soql: string): Promise<SalesforceQueryResult<T>> { return this.simulateQuery<T>(soql); }

  async create(objectName: string, fields: Record<string, unknown>): Promise<string> {
    const id = `mock_${objectName}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const record: SalesforceRecord = { Id: id, Name: (fields.Name || fields.Name__c || `Mock ${objectName}`) as string, ...Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'Id' && k !== 'Name')) } as SalesforceRecord;
    const existing = this.records.get(objectName) || [];
    existing.push(record);
    this.records.set(objectName, existing);
    return id;
  }

  async update(objectName: string, id: string, fields: Record<string, unknown>): Promise<void> {
    const records = this.records.get(objectName) || [];
    const idx = records.findIndex((r) => r.Id === id);
    if (idx >= 0) records[idx] = { ...records[idx], ...fields };
  }

  async delete(_objectName: string, _id: string): Promise<void> {}

  async describe(objectName: string): Promise<SalesforceDescribeResult> {
    const fields = this.objectFields.get(objectName) || ['Id', 'Name'];
    return { name: objectName, label: objectName, fields: fields.map((f) => ({ name: f, label: f, type: 'string', nillable: true })) };
  }

  async getRecord<T = SalesforceRecord>(objectName: string, id: string): Promise<T> {
    const records = this.records.get(objectName) || [];
    const record = records.find((r) => r.Id === id);
    if (!record) throw new Error(`Record ${id} not found in ${objectName}`);
    return record as unknown as T;
  }

  async getAvailableProducts(context: ResolvedDistributorContext): Promise<DMSProduct[]> {
    return MOCK_PRODUCTS.map((r) => ({
      productId: r.Id as string, productCode: r.ProductCode as string, productName: r.Name as string,
      family: r.Family as string, category: (r.Product_Category__c || '') as string,
      unitOfMeasure: (r.Unit_Of_Measure__c || 'Each') as string, unitPrice: (r.Unit_Price__c || 0) as number,
      packSize: (r.Pack_Size__c || 0) as number, isActive: (r.IsActive as boolean) || false,
      minOrderQtyPrimary: (r.Minimum_Order_Quantity_Primary__c || 0) as number,
      minOrderQtySecondary: (r.Minimum_Order_Quantity_Secondary__c || 0) as number,
    }));
  }

  async calculatePrimaryOrderQuote(
    _context: ResolvedDistributorContext,
    lineItems: Array<{ productId: string; quantity: number; schemeDiscount?: number }>,
    creditNoteIdsOrCorrelationId: string[] | string = [],
  ): Promise<PrimaryOrderQuote> {
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 60 * 1000);

    let totalAmount = 0;
    const items = lineItems.map((li) => {
      const product = MOCK_PRODUCTS.find((p) => p.Id === li.productId);
      const unitPrice = (product?.Unit_Price__c || 100) as number;
      const lineTotal = unitPrice * li.quantity;
      totalAmount += lineTotal;
      return {
        productId: li.productId,
        productName: (product?.Name || 'Unknown') as string,
        productCode: (product?.ProductCode || '') as string,
        quantity: li.quantity,
        unitPrice,
        totalPrice: lineTotal,
        unitOfMeasure: (product?.Unit_Of_Measure__c || 'Each') as string,
      };
    });

    const requestedSchemeDiscount = lineItems.reduce((sum, item) => sum + Math.max(0, item.schemeDiscount || 0), 0);
    const schemeDiscount = requestedSchemeDiscount || (lineItems.length >= 3 ? totalAmount * 0.10 : lineItems.length >= 2 ? totalAmount * 0.05 : 0);
    const creditNoteIds = Array.isArray(creditNoteIdsOrCorrelationId) ? creditNoteIdsOrCorrelationId : [];
    const creditNotes = creditNoteIds.includes('cnMOCK000000001')
      ? [{ creditNoteId: 'cnMOCK000000001', creditNoteNumber: 'CN-2026-0001', amount: Math.min(1500, Math.max(0, totalAmount - schemeDiscount)) }]
      : [];
    const creditApplied = creditNotes.reduce((sum, note) => sum + note.amount, 0);
    const taxAmount = Math.round(totalAmount * 0.09 * 100) / 100;

    return {
      quoteId: `QT-${now.getTime()}`,
      lineItems: items,
      totalAmount: Math.round(totalAmount * 100) / 100,
      schemeDiscount: Math.round(schemeDiscount * 100) / 100,
      discountAmount: 0,
      creditApplied: Math.round(creditApplied * 100) / 100,
      taxAmount,
      grandTotal: Math.round((totalAmount - schemeDiscount - creditApplied + taxAmount) * 100) / 100,
      appliedSchemes: lineItems.length >= 3 ? ['Volume Discount 10%'] : lineItems.length >= 2 ? ['Multi-Product Discount 5%'] : [],
      appliedOffers: [],
      appliedCreditNotes: creditNotes,
      eligibleCreditNotes: await this.getCreditNotes(_context),
      calculatedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      currency: 'INR',
    };
  }

  async createPrimaryOrder(
    context: ResolvedDistributorContext,
    quote: PrimaryOrderQuote,
  ): Promise<PrimaryOrder> {
    const orderId = `a01MOCK_${Date.now().toString(36)}`;
    const orderNumber = `PO-2026-${String(mockOrders.size + 1).padStart(4, '0')}`;
    const order: PrimaryOrder = {
      orderId, orderNumber, distributorId: context.salesforceAccountId,
      status: 'Draft', totalAmount: quote.totalAmount,
      schemeDiscount: quote.schemeDiscount, discountAmount: quote.discountAmount,
      grandTotal: quote.grandTotal, taxAmount: quote.taxAmount,
      orderDate: new Date().toISOString().split('T')[0],
      items: quote.lineItems.map((li, idx) => ({
        itemId: `item-${idx}-${li.productId.slice(-4)}`,
        productId: li.productId, productName: li.productName,
        productCode: li.productCode, quantity: li.quantity,
        unitPrice: li.unitPrice, totalPrice: li.totalPrice,
        unitOfMeasure: li.unitOfMeasure,
      })),
      approvalStatus: 'Pending',
      creditApplied: quote.creditApplied,
      appliedCreditNotes: quote.appliedCreditNotes,
    };
    mockOrders.set(orderId, [{ Id: orderId, Name: orderNumber, Status__c: 'Draft', Distributor__c: context.salesforceAccountId, ...order } as unknown as SalesforceRecord]);
    return order;
  }

  async getPrimaryOrders(context: ResolvedDistributorContext): Promise<PrimaryOrder[]> {
    return MOCK_PURCHASE_ORDERS
      .filter((o) => o.Distributor__c === context.salesforceAccountId)
      .map((r) => ({
        orderId: r.Id as string, orderNumber: r.Name as string,
        distributorId: r.Distributor__c as string, status: r.Status__c as string,
        totalAmount: (r.Total_Amount__c || 0) as number,
        schemeDiscount: (r.Scheme_Discount__c || 0) as number,
        discountAmount: (r.Discount_Amount__c || 0) as number,
        grandTotal: (r.Grand_Total__c || 0) as number,
        taxAmount: (r.Tax_Amount__c || 0) as number,
        orderDate: (r.Order_Date__c || '') as string,
        items: [],
        approvalStatus: (r.Approval_Status__c || '') as string,
      }));
  }

  async getPrimaryOrderDetails(
    context: ResolvedDistributorContext,
    orderId: string,
  ): Promise<PrimaryOrderDetail> {
    const order = MOCK_PURCHASE_ORDERS.find((o) => o.Id === orderId && o.Distributor__c === context.salesforceAccountId);
    if (!order) throw new Error('Order not found');
    return {
      orderId: order.Id as string, orderNumber: order.Name as string,
      distributorId: order.Distributor__c as string, status: order.Status__c as string,
      totalAmount: (order.Total_Amount__c || 0) as number,
      schemeDiscount: (order.Scheme_Discount__c || 0) as number,
      discountAmount: (order.Discount_Amount__c || 0) as number,
      grandTotal: (order.Grand_Total__c || 0) as number,
      taxAmount: (order.Tax_Amount__c || 0) as number,
      orderDate: (order.Order_Date__c || '') as string,
      items: MOCK_PRODUCTS.slice(0, 2).map((p, idx) => ({
        itemId: `item-${idx}-${p.Id.slice(-4)}`, productId: p.Id as string,
        productName: p.Name as string, productCode: (p.ProductCode || '') as string,
        quantity: 50, unitPrice: (p.Unit_Price__c || 0) as number,
        totalPrice: (p.Unit_Price__c || 0) as number * 50,
        unitOfMeasure: (p.Unit_Of_Measure__c || 'Each') as string,
        fulfilledQuantity: 25, expectedQuantity: 50, deliveryStatus: 'Partially Fulfilled',
      })),
      approvalStatus: (order.Approval_Status__c || '') as string,
      fulfillmentStatus: (order.Fulfillment_Status__c || 'Not Fulfilled') as string,
      grnIds: order.Status__c === 'Approved' ? ['grnMOCK000000001'] : [],
      returnOrderIds: order.Status__c === 'Approved' ? ['a02MOCK000000001'] : [],
      invoiceIds: ['a03MOCK000000001'],
      dispatchIds: [],
    };
  }

  async createOrUpdateGRN(
    context: ResolvedDistributorContext,
    orderId: string,
    grnData: GRNPayload,
  ): Promise<GRNResult> {
    const grnId = `grnMOCK_${Date.now().toString(36)}`;
    let createdReturnId: string | undefined;
    if (grnData.items.some((i) => i.damagedQuantity > 0 || i.missingQuantity > 0)) {
      createdReturnId = `a02MOCK_RO_${Date.now().toString(36)}`;
    }
    const result: GRNResult = {
      grnId, grnNumber: `GRN-2026-${String(mockGRNs.size + 1).padStart(4, '0')}`,
      orderId, status: 'Completed',
      createdReturnOrderId: createdReturnId,
      items: grnData.items.map((i) => ({
        productId: i.productId, receivedQuantity: i.receivedQuantity,
        damagedQuantity: i.damagedQuantity, missingQuantity: i.missingQuantity,
      })),
      notes: grnData.notes,
    };
    mockGRNs.set(grnId, [result as unknown as SalesforceRecord]);
    return result;
  }

  async getGRNDetails(_context: ResolvedDistributorContext, grnId: string): Promise<GRNResult> {
    const grn = mockGRNs.get(grnId);
    if (!grn || grn.length === 0) throw new Error('GRN not found');
    return grn[0] as unknown as GRNResult;
  }

  async getReturnOrders(context: ResolvedDistributorContext): Promise<ReturnOrder[]> {
    return MOCK_RETURN_ORDERS
      .filter((r) => r.Account__c === context.salesforceAccountId)
      .map((r) => ({
        returnId: r.Id as string, returnNumber: r.Name as string,
        accountId: r.Account__c as string, orderId: (r.Order__c || '') as string,
        status: r.Status__c as string, grandTotal: (r.Grand_Total__c || 0) as number,
        description: (r.Description__c || '') as string,
        type: (r.Type__c || '') as string, items: [],
      }));
  }

  async getReturnOrderDetails(
    context: ResolvedDistributorContext,
    returnOrderId: string,
  ): Promise<ReturnOrderDetail> {
    const ro = MOCK_RETURN_ORDERS.find((r) => r.Id === returnOrderId && r.Account__c === context.salesforceAccountId);
    if (!ro) throw new Error('Return order not found');
    return {
      returnId: ro.Id as string, returnNumber: ro.Name as string,
      accountId: ro.Account__c as string, orderId: (ro.Order__c || '') as string,
      status: ro.Status__c as string, grandTotal: (ro.Grand_Total__c || 0) as number,
      description: (ro.Description__c || '') as string, type: (ro.Type__c || '') as string,
      items: [], approvalStatus: (ro.Approval_Status__c || '') as string,
      claimIds: ['clmMOCK000000001'], creditNoteIds: ['cnMOCK000000001'],
      linkedGRNId: (ro.Goods_Receipt_Note__c || '') as string,
    };
  }

  async getClaims(context: ResolvedDistributorContext): Promise<Claim[]> {
    return [{
      claimId: 'clmMOCK000000001', claimNumber: 'CLM-2026-0001',
      accountId: context.salesforceAccountId, returnOrderId: 'a02MOCK000000001',
      claimType: 'Damaged Goods', status: 'Open',
        amount: 1500.00, totalAmount: 1500.00,
      notes: '10 units of Beverage Pack A damaged in transit',
    }];
  }

  async createOrUpdateClaim(
    context: ResolvedDistributorContext,
    claimData: ClaimPayload,
  ): Promise<Claim> {
    const claimId = `clmMOCK_${Date.now().toString(36)}`;
    const claim: Claim = {
      claimId, claimNumber: `CLM-2026-${String(mockClaims.size + 1).padStart(4, '0')}`,
      accountId: context.salesforceAccountId,
      returnOrderId: claimData.returnOrderId,
      claimType: claimData.claimType, status: 'Submitted',
      amount: claimData.amount, totalAmount: claimData.amount,
      notes: claimData.description,
    };
    mockClaims.set(claimId, [claim as unknown as SalesforceRecord]);
    return claim;
  }

  async uploadFileToRecord(
    _context: ResolvedDistributorContext,
    recordId: string,
    filePayload: FileUploadPayload,
  ): Promise<FileUploadResult> {
    mockFileCounter++;
    return {
      fileId: `068MOCK${String(mockFileCounter).padStart(6, '0')}`,
      contentDocumentId: `069MOCK${String(mockFileCounter).padStart(6, '0')}`,
      linkedToRecord: recordId,
    };
  }

  async submitForApproval(
    _context: ResolvedDistributorContext,
    recordId: string,
  ): Promise<ApprovalResult> {
    return { success: true, newStatus: 'Pending Approval', message: 'Record submitted for approval successfully.' };
  }

  async getApprovalStatus(
    _context: ResolvedDistributorContext,
    recordId: string,
  ): Promise<ApprovalStatus> {
    if (recordId === 'a02MOCK000000001') {
      return {
        recordId, status: 'Approved', isPending: false, isApproved: true, isRejected: false,
        submittedDate: '2026-05-02T10:00:00Z', approvedDate: '2026-05-03T14:00:00Z',
        approverName: 'Regional Manager',
      };
    }
    return { recordId, status: 'Pending', isPending: true, isApproved: false, isRejected: false };
  }

  async getCreditNotes(context: ResolvedDistributorContext): Promise<CreditNote[]> {
    return [{
      creditNoteId: 'cnMOCK000000001', creditNoteNumber: 'CN-2026-0001',
      accountId: context.salesforceAccountId, returnOrderId: 'a02MOCK000000001',
      status: 'Issued', amount: 1500.00, availableAmount: 1500.00, usedAmount: 0,
      createdDate: '2026-05-04', type: 'Return',
    }];
  }

  async getSecondaryOrders(context: ResolvedDistributorContext): Promise<SecondaryOrder[]> {
    return MOCK_SECONDARY_ORDERS.filter((o) => o.Distributor__c === context.salesforceAccountId).map((r) => ({
      orderId: r.Id as string, orderNumber: r.Name as string, distributorId: r.Distributor__c as string,
      retailerCustomer: (r.Retailer_Customer__c || 'Unknown') as string,
      status: r.Status__c as string, totalAmount: (r.Total_Amount__c || 0) as number,
      fulfillmentStatus: (r.Fulfillment_Status__c || '') as string,
      invoiceStatus: (r.Invoice_Status__c || '') as string,
      dispatchStatus: (r.Dispatch_Status__c || '') as string,
      orderDate: (r.Order_Date__c || '') as string, items: [],
      requestedDeliveryDate: (r.Requested_Delivery_Date__c || '') as string,
    }));
  }

  async getSecondaryOrderDetails(ctx: ResolvedDistributorContext, orderId: string): Promise<SecondaryOrderDetail> {
    const so = MOCK_SECONDARY_ORDERS.find((o) => o.Id === orderId && o.Distributor__c === ctx.salesforceAccountId);
    if (!so) throw new Error('Secondary order not found or access denied');
    return {
      orderId: so.Id as string, orderNumber: so.Name as string, distributorId: so.Distributor__c as string,
      retailerCustomer: (so.Retailer_Customer__c || 'Unknown') as string,
      status: so.Status__c as string, totalAmount: (so.Total_Amount__c || 0) as number,
      fulfillmentStatus: (so.Fulfillment_Status__c || '') as string,
      invoiceStatus: (so.Invoice_Status__c || '') as string,
      dispatchStatus: (so.Dispatch_Status__c || '') as string,
      orderDate: (so.Order_Date__c || '') as string,
      requestedDeliveryDate: (so.Requested_Delivery_Date__c || '') as string,
      items: MOCK_PRODUCTS.slice(0, 2).map((p, idx) => ({
        itemId: `soi-${idx}`, productId: p.Id as string, productName: p.Name as string,
        orderedQuantity: 30, availableQuantity: 20, fulfilledQuantity: 0, pendingQuantity: 30,
        unitPrice: (p.Unit_Price__c || 0) as number, unitOfMeasure: (p.Unit_Of_Measure__c || 'Each') as string,
      })),
      invoiceIds: ['a03MOCK000000001'], dispatchIds: ['d04MOCK000000001'], grnIds: [],
      canCreateInvoice: true, canUpdateDispatch: true, hasPendingDispatch: true,
      sourceAddress: '123 Distributor Warehouse, Mumbai', destinationAddress: '456 Retail Store, Pune',
      remainingQtys: MOCK_PRODUCTS.slice(0, 2).map((p) => ({
        productId: p.Id as string, productName: p.Name as string, orderedQty: 30, remainingQty: 30,
      })),
    };
  }

  async getInventoryAvailability(_ctx: ResolvedDistributorContext, _orderId: string): Promise<InventoryAvailability[]> {
    return MOCK_PRODUCTS.slice(0, 2).map((p) => ({
      productId: p.Id as string, productName: p.Name as string,
      orderedQuantity: 30, availableQuantity: 30,
      batchDetails: [{ batchId: 'bat001', quantity: 15, expiryDate: '2027-01-01' }, { batchId: 'bat002', quantity: 15, expiryDate: '2027-06-01' }],
    }));
  }

  async createInvoice(ctx: ResolvedDistributorContext, _orderId: string, payload: InvoicePayload): Promise<DMSInvoice> {
    const id = `invMOCK_${Date.now().toString(36)}`;
    return { invoiceId: id, invoiceNumber: `INV-SO-${id.slice(-4)}`, accountId: ctx.salesforceAccountId, orderId: _orderId, status: 'Generated', totalAmount: 4500.00, invoiceDate: new Date().toISOString().split('T')[0], paymentStatus: 'Unpaid', type: payload.fullOrPartial, fullPartial: payload.fullOrPartial };
  }

  async getInvoiceDetails(_ctx: ResolvedDistributorContext, invoiceId: string): Promise<DMSInvoice> {
    return { invoiceId, invoiceNumber: `INV-SO-${invoiceId.slice(-4)}`, accountId: '001MOCK000000001', status: 'Generated', totalAmount: 4500.00, paymentStatus: 'Unpaid', type: 'Full', fullPartial: 'Full' };
  }

  async getDispatchRequests(_ctx: ResolvedDistributorContext, orderId: string): Promise<DispatchRequest[]> {
    return [{ dispatchId: 'd04MOCK000000001', dispatchName: 'DSP-2026-0001', orderId, status: 'Pending', invoiceId: 'a03MOCK000000001', startDate: '2026-05-05', endDate: '2026-05-07', sourceAddress: 'Mumbai', destinationAddress: 'Pune' }];
  }

  async updateDispatchStatus(_ctx: ResolvedDistributorContext, dispatchId: string, newStatus: string): Promise<DispatchRequest> {
    return { dispatchId, dispatchName: 'DSP-2026-0001', orderId: 'a01MOCK000000001', status: newStatus, startDate: '2026-05-05', endDate: '2026-05-07', sourceAddress: 'Mumbai', destinationAddress: 'Pune' };
  }

  async getSecondaryOrderGRN(_ctx: ResolvedDistributorContext, orderId: string): Promise<SecondaryOrderGRN> {
    return { grnId: 'grnSO001', grnNumber: 'GRN-SO-0001', secondaryOrderId: orderId, status: 'Completed', items: [{ productId: '01tMOCK000000001', receivedQuantity: 30 }] };
  }

  async getGoodsReceiptLines(_ctx: ResolvedDistributorContext, _orderId: string): Promise<Array<{ lineId: string; grnId: string; grnNumber: string; productId: string; productName: string; orderedQuantity: number; receivedQuantity: number; lostQuantity: number; damagedQuantity: number; status?: string }>> {
    return MOCK_PRODUCTS.slice(0, 2).map((p, idx) => ({
      lineId: `grnLineMOCK${idx + 1}`,
      grnId: 'grnSO001',
      grnNumber: 'GRN-SO-0001',
      productId: p.Id as string,
      productName: p.Name as string,
      orderedQuantity: 20,
      receivedQuantity: 0,
      lostQuantity: 0,
      damagedQuantity: 0,
      status: 'New',
    }));
  }

  async updateGoodsReceiptLines(_ctx: ResolvedDistributorContext, _orderId: string, _items: Array<{ lineId: string; receivedQty: number; lostQty: number; damagedQty: number }>): Promise<{ grnId: string; grnNumber: string }> {
    return { grnId: 'grnSO001', grnNumber: 'GRN-SO-0001' };
  }

  async getInvoiceLineItems(_ctx: ResolvedDistributorContext, invoiceId: string): Promise<Array<{ productId: string; productName: string; quantity: number }>> {
    return MOCK_PRODUCTS.slice(0, 2).map((p) => ({
      productId: p.Id as string,
      productName: p.Name as string,
      quantity: 20,
    }));
  }

  async createGRNFromDelivery(_ctx: ResolvedDistributorContext, _orderId: string, _invoiceId: string, items: Array<{ productId: string; receivedQty: number; lostQty: number; damagedQty: number }>): Promise<{ grnId: string; grnNumber: string }> {
    const grnId = `grnDEL_${Date.now().toString(36)}`;
    return { grnId, grnNumber: `GRN-${grnId.slice(-6).toUpperCase()}` };
  }

  async getARSConfig(_ctx: ResolvedDistributorContext): Promise<ArsConfig> {
    return {
      autoReplenishmentEnabled: true,
      activeProducts: { productId: '01tMOCK000000001', productName: 'Beverage Pack A', currentStock: 25, minThreshold: 10, maxThreshold: 50, reorderPoint: 15, reorderQuantity: 30, isActive: true },
      minThreshold: 10, maxThreshold: 50, replenishmentFrequency: 'weekly', lastModifiedBy: 'System', lastModifiedDate: '2026-05-01',
    };
  }

  async updateARSStatus(_ctx: ResolvedDistributorContext, active: boolean): Promise<ArsConfig> {
    const cfg = await this.getARSConfig(_ctx);
    cfg.autoReplenishmentEnabled = active;
    cfg.lastModifiedDate = new Date().toISOString();
    return cfg;
  }

  async getBatchWiseStockPolicies(_ctx: ResolvedDistributorContext): Promise<BatchStockPolicy[]> {
    return [
      { batchId: 'bat001', batchNumber: 'BATCH-A-001', productId: '01tMOCK000000001', productName: 'Beverage Pack A', availableStock: 15, minStock: 5, maxStock: 30, expiryDate: '2027-01-15', replenishmentStatus: 'Active', lastUpdated: '2026-05-01' },
      { batchId: 'bat002', batchNumber: 'BATCH-A-002', productId: '01tMOCK000000001', productName: 'Beverage Pack A', availableStock: 10, minStock: 5, maxStock: 30, expiryDate: '2026-08-01', replenishmentStatus: 'Warning', lastUpdated: '2026-05-01' },
      { batchId: 'bat003', batchNumber: 'BATCH-B-001', productId: '01tMOCK000000002', productName: 'Snack Box B', availableStock: 8, minStock: 10, maxStock: 40, expiryDate: '2026-12-01', replenishmentStatus: 'Below Min', lastUpdated: '2026-05-01' },
    ];
  }

  async getARSTriggeredOrders(_ctx: ResolvedDistributorContext): Promise<ArsTriggeredOrder[]> {
    return [{ orderId: 'arsPO001', orderNumber: 'ARS-PO-2026-0001', productId: '01tMOCK000000002', productName: 'Snack Box B', quantity: 30, reason: 'Stock below minimum threshold', minThreshold: 10, maxThreshold: 40, currentStock: 8, status: 'Approved', triggerDate: '2026-05-02' }];
  }

  async applyARSPolicyChanges(
    _accountId: string,
    _changes: Array<{ productId: string; newMin: number; newMax: number }>,
  ): Promise<void> {
    // no-op in mock mode
  }

  async getBusinessInsightsEnhanced(_ctx: ResolvedDistributorContext): Promise<AIBusinessInsight[]> {
    return [
      { insightId: 'ai001', type: 'performance', title: 'Monthly Sales Growth', description: 'Your distributor sales have grown 15.5% MoM driven by Beverage and Oil categories.', metric: '15.5%', metricValue: 15.5, generatedAt: new Date().toISOString(), actionable: false },
      { insightId: 'ai002', type: 'warning', title: 'Stock Running Low', description: 'Snack Box B is at 8 units (below 10-unit minimum). ARS has triggered a replenishment order.', metric: '8 units', metricValue: 8, generatedAt: new Date().toISOString(), actionable: true },
      { insightId: 'ai003', type: 'opportunity', title: 'Upsell Opportunity', description: 'Wakanda General Store shows 40% growth potential based on catchment analysis.', metric: '40%', metricValue: 40, generatedAt: new Date().toISOString(), actionable: true },
      { insightId: 'ai004', type: 'recommendation', title: 'Adjust Reorder Point', description: 'Beverage Pack A reorder point of 15 may be too low given 25% weekly consumption increase.', metric: '25%', metricValue: 25, generatedAt: new Date().toISOString(), actionable: true },
    ];
  }

  async getStockThresholdRecommendations(_ctx: ResolvedDistributorContext): Promise<AIStockRecommendation[]> {
    return [{ recommendationId: 'rec001', productId: '01tMOCK000000001', productName: 'Beverage Pack A', currentMinThreshold: 10, currentMaxThreshold: 50, suggestedMinThreshold: 15, suggestedMaxThreshold: 60, reasoning: 'Weekly consumption increased 25% over the last 4 weeks.', confidence: 0.85, generatedAt: new Date().toISOString(), applied: false }];
  }

  async getUpsellRecommendations(_ctx: ResolvedDistributorContext): Promise<AIUpsellRecommendation[]> {
    return [
      { recommendationId: 'up001', retailerId: 'r001', retailerName: 'Wakanda General Store', productId: '01tMOCK000000003', productName: 'Dairy Pack C', opportunityScore: 85, reason: 'High dairy consumption; no current dairy supplier', estimatedRevenue: 45000 },
      { recommendationId: 'up002', retailerId: 'r002', retailerName: 'Gotham Mart', productId: '01tMOCK000000004', productName: 'Oil Can D', opportunityScore: 72, reason: 'Top oil-consuming area; competing brand advantage', estimatedRevenue: 32000 },
    ];
  }

  async applyStockThresholdRecommendation(_ctx: ResolvedDistributorContext, recommendationId: string): Promise<AIStockRecommendation> {
    return { recommendationId, productId: '01tMOCK000000001', productName: 'Beverage Pack A', currentMinThreshold: 10, currentMaxThreshold: 50, suggestedMinThreshold: 15, suggestedMaxThreshold: 60, reasoning: 'Applied per Slack user confirmation.', confidence: 0.85, generatedAt: new Date().toISOString(), applied: true };
  }

  private seedData(): void {
    this.objectFields.set('Account', ['Id', 'Name', 'Type', 'IsPartner', 'Email__c', 'Distributor__c', 'Business_Type__c']);
    this.objectFields.set('Contact', ['Id', 'Email', 'FirstName', 'LastName', 'AccountId', 'Distributor__c']);
    this.objectFields.set('Product2', ['Id', 'Name', 'ProductCode', 'Family', 'IsActive', 'Unit_Of_Measure__c', 'Unit_Price__c', 'Brand_Name__c', 'Pack_Size__c', 'Minimum_Order_Quantity_Primary__c', 'Product_Category__c']);
    this.objectFields.set('Order', ['Id', 'OrderNumber', 'AccountId', 'Status', 'EffectiveDate', 'TotalAmount', 'Grand_Total__c', 'Discount_Amount__c', 'Tax_Amount__c', 'Approval_Status__c', 'Description']);
    this.objectFields.set('PurchaseOrder__c', ['Id', 'Name', 'Distributor__c', 'Status__c', 'Total_Amount__c', 'Scheme_Discount__c', 'Discount_Amount__c', 'Grand_Total__c', 'Fulfillment_Status__c', 'Approval_Status__c']);
    this.objectFields.set('Return_Order__c', ['Id', 'Name', 'Account__c', 'Status__c', 'Grand_Total__c', 'Order__c', 'Type__c', 'Description__c', 'Approval_Status__c', 'Goods_Receipt_Note__c']);
    this.objectFields.set('Invoice__c', ['Id', 'Name', 'Billing_Account__c', 'Status__c', 'Total_Amount__c', 'Invoice_Date__c', 'Payment_Status__c', 'Type__c']);
    this.objectFields.set('Claim__c', ['Id', 'Name', 'Account__c', 'Claim_Type__c', 'Status__c', 'Amount__c', 'Total_Amount__c', 'Notes__c', 'Claim_Number__c', 'Distributor__c']);
    this.objectFields.set('GRN__c', ['Id', 'Name', 'Status__c', 'Order__c']);
    this.objectFields.set('Dispatch_Request__c', ['Id', 'Name', 'Order__c', 'Status__c', 'Dispatch_Request_Name__c']);
    this.objectFields.set('Inventory_Batch__c', ['Id', 'Product__c', 'Distributor__c', 'Expiry_Date__c', 'Status__c']);
    this.objectFields.set('StoreScheme__c', ['Id', 'Retail_Store__c', 'Status__c', 'Start_Date__c', 'End_Date__c']);
    this.objectFields.set('Scheme_Slab_Target__c', ['Id', 'Promotion__c', 'Discount_Type__c', 'Discount__c']);
    this.objectFields.set('Credit_Note__c', ['Id', 'Name', 'Account__c', 'Status__c', 'Amount__c', 'Return_Order__c', 'Claim__c']);
    this.objectFields.set('ContentVersion', ['Id', 'Title', 'ContentDocumentId', 'FileType', 'ContentSize']);
    this.objectFields.set('ContentDocumentLink', ['Id', 'ContentDocumentId', 'LinkedEntityId', 'ShareType', 'Visibility']);
  }

  private simulateQuery<T>(soql: string): SalesforceQueryResult<T> {
    const lower = soql.toLowerCase();
    if (lower.includes('from contact')) {
      const records = this.filterByEmail(MOCK_CONTACTS, soql, 'Email');
      return { totalSize: records.length, done: true, records: records as unknown as T[] };
    }
    if (lower.includes('from account')) {
      let records = this.filterByEmail(MOCK_ACCOUNTS, soql, 'Email__c');
      if (lower.includes('id =')) records = this.filterById(MOCK_ACCOUNTS, soql);
      return { totalSize: records.length, done: true, records: records as unknown as T[] };
    }
    if (lower.includes('from product2')) return { totalSize: MOCK_PRODUCTS.length, done: true, records: MOCK_PRODUCTS as unknown as T[] };
    if (lower.includes('from order')) {
      let records: SalesforceRecord[] = MOCK_PURCHASE_ORDERS.map((order) => ({
        Id: order.Id,
        OrderNumber: order.Name,
        AccountId: order.Distributor__c,
        Status: order.Status__c,
        EffectiveDate: order.Order_Date__c,
        TotalAmount: order.Grand_Total__c,
        Grand_Total__c: order.Grand_Total__c,
        Discount_Amount__c: order.Discount_Amount__c,
        Tax_Amount__c: order.Tax_Amount__c,
        Approval_Status__c: order.Approval_Status__c,
        Description: order.Notes__c,
      }));
      records = this.filterByField(records, soql, 'Id');
      records = this.filterByField(records, soql, 'AccountId');
      return { totalSize: records.length, done: true, records: records as unknown as T[] };
    }
    if (lower.includes('from purchaseorder__c')) {
      let records = this.filterByField(MOCK_PURCHASE_ORDERS, soql, 'Id');
      records = this.filterByField(records, soql, 'Distributor__c');
      return { totalSize: records.length, done: true, records: records as unknown as T[] };
    }
    if (lower.includes('from return_order__c')) {
      let records = this.filterByField(MOCK_RETURN_ORDERS, soql, 'Id');
      records = this.filterByField(records, soql, 'Account__c');
      return { totalSize: records.length, done: true, records: records as unknown as T[] };
    }
    if (lower.includes('from invoice__c')) {
      let records = this.filterByField(MOCK_INVOICES, soql, 'Id');
      records = this.filterByField(records, soql, 'Billing_Account__c');
      return { totalSize: records.length, done: true, records: records as unknown as T[] };
    }
    return { totalSize: 0, done: true, records: [] };
  }

  private filterByEmail(records: SalesforceRecord[], soql: string, emailField: string): SalesforceRecord[] {
    const match = soql.match(/(?:WHERE|AND)\s+(?:\w+\.)?(\w+)\s*=\s*'([^']+)'/i);
    if (match && match[1] === emailField) return records.filter((r) => r[emailField] === match[2]);
    return records;
  }

  private filterById(records: SalesforceRecord[], soql: string): SalesforceRecord[] {
    return this.filterByField(records, soql, 'Id');
  }

  private filterByField(records: SalesforceRecord[], soql: string, fieldName: string): SalesforceRecord[] {
    const regex = new RegExp(`(?:WHERE|AND)\\s+(?:\\w+\\.)?(${fieldName})\\s*=\\s*'([^']+)'`, 'gi');
    let filtered = records;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(soql)) !== null) {
      filtered = filtered.filter((r) => String(r[fieldName] || '') === match![2]);
    }
    return filtered;
  }
}
