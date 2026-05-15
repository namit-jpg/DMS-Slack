export interface SalesforceRecord {
  Id: string;
  Name?: string;
  [key: string]: unknown;
}

export interface SalesforceQueryResult<T = SalesforceRecord> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

export interface SalesforceDescribeResult {
  name: string;
  label: string;
  fields: SalesforceFieldDescribe[];
  recordTypeInfos?: SalesforceRecordTypeInfo[];
}

export interface SalesforceFieldDescribe {
  name: string;
  label: string;
  type: string;
  picklistValues?: Array<{ value: string; label: string; active: boolean }>;
  referenceTo?: string[];
  relationshipName?: string;
  calculatedFormula?: string;
  nillable: boolean;
  defaultValue?: unknown;
}

export interface SalesforceRecordTypeInfo {
  name: string;
  recordTypeId: string;
  developerName: string;
  available: boolean;
}

export interface SalesforceAuthToken {
  accessToken: string;
  instanceUrl: string;
  id?: string;
  issuedAt?: string;
  signature?: string;
}

export interface ISalesforceClient {
  query<T = SalesforceRecord>(
    soql: string,
    correlationId?: string,
  ): Promise<SalesforceQueryResult<T>>;

  queryAll<T = SalesforceRecord>(
    soql: string,
    correlationId?: string,
  ): Promise<SalesforceQueryResult<T>>;

  create(
    objectName: string,
    fields: Record<string, unknown>,
    correlationId?: string,
  ): Promise<string>;

  update(
    objectName: string,
    id: string,
    fields: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void>;

  delete(objectName: string, id: string, correlationId?: string): Promise<void>;

  describe(
    objectName: string,
    correlationId?: string,
  ): Promise<SalesforceDescribeResult>;

  getRecord<T = SalesforceRecord>(
    objectName: string,
    id: string,
    fields?: string[],
    correlationId?: string,
  ): Promise<T>;

  getAvailableProducts(
    context: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<DMSProduct[]>;

  calculatePrimaryOrderQuote(
    context: ResolvedDistributorContext,
    lineItems: Array<{ productId: string; quantity: number; schemeDiscount?: number }>,
    creditNoteIdsOrCorrelationId?: string[] | string,
    correlationId?: string,
  ): Promise<PrimaryOrderQuote>;

  createPrimaryOrder(
    context: ResolvedDistributorContext,
    quotePayload: PrimaryOrderQuote,
    correlationId?: string,
  ): Promise<PrimaryOrder>;

  getPrimaryOrders(
    context: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<PrimaryOrder[]>;

  getPrimaryOrderDetails(
    context: ResolvedDistributorContext,
    orderId: string,
    correlationId?: string,
  ): Promise<PrimaryOrderDetail>;

  createOrUpdateGRN(
    context: ResolvedDistributorContext,
    orderId: string,
    grnPayload: GRNPayload,
    correlationId?: string,
  ): Promise<GRNResult>;

  getGRNDetails(
    context: ResolvedDistributorContext,
    grnId: string,
    correlationId?: string,
  ): Promise<GRNResult>;

  getReturnOrders(
    context: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<ReturnOrder[]>;

  getReturnOrderDetails(
    context: ResolvedDistributorContext,
    returnOrderId: string,
    correlationId?: string,
  ): Promise<ReturnOrderDetail>;

  getClaims(
    context: ResolvedDistributorContext,
    returnOrderId?: string,
    correlationId?: string,
  ): Promise<Claim[]>;

  createOrUpdateClaim(
    context: ResolvedDistributorContext,
    claimPayload: ClaimPayload,
    correlationId?: string,
  ): Promise<Claim>;

  uploadFileToRecord(
    context: ResolvedDistributorContext,
    recordId: string,
    filePayload: FileUploadPayload,
    correlationId?: string,
  ): Promise<FileUploadResult>;

  submitForApproval(
    context: ResolvedDistributorContext,
    recordId: string,
    objectName: string,
    correlationId?: string,
  ): Promise<ApprovalResult>;

  getApprovalStatus(
    context: ResolvedDistributorContext,
    recordId: string,
    objectName: string,
    correlationId?: string,
  ): Promise<ApprovalStatus>;

  getCreditNotes(
    context: ResolvedDistributorContext,
    returnOrderId?: string,
    correlationId?: string,
  ): Promise<CreditNote[]>;

  // Secondary Orders
  getSecondaryOrders(context: ResolvedDistributorContext, correlationId?: string): Promise<SecondaryOrder[]>;
  getSecondaryOrderDetails(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<SecondaryOrderDetail>;
  getInventoryAvailability(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<InventoryAvailability[]>;
  createInvoice(context: ResolvedDistributorContext, secondaryOrderId: string, invoicePayload: InvoicePayload, correlationId?: string): Promise<DMSInvoice>;
  getInvoiceDetails(context: ResolvedDistributorContext, invoiceId: string, correlationId?: string): Promise<DMSInvoice>;
  getDispatchRequests(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<DispatchRequest[]>;
  updateDispatchStatus(context: ResolvedDistributorContext, dispatchRequestId: string, newStatus: string, correlationId?: string): Promise<DispatchRequest>;
  getSecondaryOrderGRN(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<SecondaryOrderGRN>;
  getInvoiceLineItems(context: ResolvedDistributorContext, invoiceId: string, correlationId?: string): Promise<Array<{ productId: string; productName: string; quantity: number }>>;
  createGRNFromDelivery(context: ResolvedDistributorContext, orderId: string, invoiceId: string, items: Array<{ productId: string; receivedQty: number; lostQty: number; damagedQty: number }>, correlationId?: string): Promise<{ grnId: string; grnNumber: string }>;

  // ARS
  getARSConfig(context: ResolvedDistributorContext, correlationId?: string): Promise<ArsConfig>;
  updateARSStatus(context: ResolvedDistributorContext, active: boolean, correlationId?: string): Promise<ArsConfig>;
  getBatchWiseStockPolicies(context: ResolvedDistributorContext, correlationId?: string): Promise<BatchStockPolicy[]>;
  getARSTriggeredOrders(context: ResolvedDistributorContext, correlationId?: string): Promise<ArsTriggeredOrder[]>;
  applyARSPolicyChanges(
    accountId: string,
    changes: Array<{ productId: string; newMin: number; newMax: number }>,
    correlationId?: string,
  ): Promise<void>;

  // AI Insights
  getBusinessInsightsEnhanced(context: ResolvedDistributorContext, correlationId?: string): Promise<AIBusinessInsight[]>;
  getStockThresholdRecommendations(context: ResolvedDistributorContext, correlationId?: string): Promise<AIStockRecommendation[]>;
  getUpsellRecommendations(context: ResolvedDistributorContext, correlationId?: string): Promise<AIUpsellRecommendation[]>;
  applyStockThresholdRecommendation(context: ResolvedDistributorContext, recommendationId: string, correlationId?: string): Promise<AIStockRecommendation>;

  isMock(): boolean;
}

export interface ResolvedDistributorContext {
  slackUserId: string;
  slackTeamId: string;
  slackEnterpriseId: string | null;
  slackEmail: string;
  salesforceAccountId: string;
  accountName: string;
  distributorCode: string | null;
  mappingSource: 'AccountEmail' | 'ContactEmail' | 'PersonAccountEmail' | 'DistributorObject';
  resolvedAt: string;
  isActive: boolean;
  accountType: string;
  businessType: string;
}

export interface DMSProduct {
  productId: string;
  pricebookEntryId?: string;
  pricebookId?: string;
  productCode: string;
  productName: string;
  family: string;
  category: string;
  unitOfMeasure: string;
  unitPrice: number;
  packSize: number;
  isActive: boolean;
  minOrderQtyPrimary: number | null;
  minOrderQtySecondary: number | null;
}

export interface PrimaryOrder {
  orderId: string;
  orderNumber: string;
  distributorId: string;
  status: string;
  totalAmount: number;
  schemeDiscount: number;
  discountAmount: number;
  grandTotal: number;
  taxAmount: number;
  orderDate: string;
  items: PrimaryOrderItem[];
  approvalStatus?: string;
  notes?: string;
  creditApplied?: number;
  appliedCreditNotes?: AppliedCreditNote[];
}

export interface PrimaryOrderItem {
  itemId: string;
  productId: string;
  productName: string;
  productCode: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unitOfMeasure: string;
  goodQuantity?: number;
  defectiveQuantity?: number;
}

export interface PrimaryOrderDetail {
  orderId: string;
  orderNumber: string;
  distributorId: string;
  status: string;
  totalAmount: number;
  schemeDiscount: number;
  discountAmount: number;
  grandTotal: number;
  taxAmount: number;
  orderDate: string;
  items: PrimaryOrderItemDetail[];
  approvalStatus?: string;
  notes?: string;
  fulfillmentStatus: string;
  grnIds: string[];
  returnOrderIds: string[];
  invoiceIds: string[];
  dispatchIds: string[];
  creditApplied?: number;
  creditNoteUsageIds?: string[];
}

export interface PrimaryOrderItemDetail extends PrimaryOrderItem {
  fulfilledQuantity: number;
  expectedQuantity: number;
  deliveryStatus: string;
  remainingQty?: number;
}

export interface PrimaryOrderQuote {
  quoteId: string;
  lineItems: Array<{
    productId: string;
    pricebookEntryId?: string;
    productName: string;
    productCode: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    unitOfMeasure: string;
  }>;
  totalAmount: number;
  schemeDiscount: number;
  discountAmount: number;
  creditApplied: number;
  taxAmount: number;
  grandTotal: number;
  appliedSchemes: string[];
  appliedOffers: string[];
  appliedCreditNotes: AppliedCreditNote[];
  eligibleCreditNotes?: CreditNote[];
  calculatedAt: string;
  expiresAt: string;
  currency: string;
}

export interface AppliedCreditNote {
  creditNoteId: string;
  creditNoteNumber: string;
  amount: number;
}

export interface GRNPayload {
  items: Array<{
    productId: string;
    expectedQuantity: number;
    receivedQuantity: number;
    damagedQuantity: number;
    missingQuantity: number;
  }>;
  notes: string;
}

export interface GRNResult {
  grnId: string;
  grnNumber: string;
  orderId: string;
  status: string;
  createdReturnOrderId?: string;
  items: Array<{
    productId: string;
    receivedQuantity: number;
    damagedQuantity: number;
    missingQuantity: number;
  }>;
  notes: string;
}

export interface ReturnOrderDetail extends ReturnOrder {
  approvalStatus?: string;
  claimIds: string[];
  creditNoteIds: string[];
  linkedGRNId?: string;
}

export interface ClaimPayload {
  returnOrderId?: string;
  orderId?: string;
  claimType: string;
  amount: number;
  description: string;
  purchaseReturnClaimType?: string;
}

export interface FileUploadPayload {
  fileName: string;
  contentBase64: string;
  contentType: string;
  description?: string;
}

export interface FileUploadResult {
  fileId: string;
  contentDocumentId: string;
  linkedToRecord: string;
}

export interface ApprovalResult {
  success: boolean;
  newStatus: string;
  message: string;
}

export interface ApprovalStatus {
  recordId: string;
  status: string;
  isPending: boolean;
  isApproved: boolean;
  isRejected: boolean;
  submittedDate?: string;
  approvedDate?: string;
  rejectedDate?: string;
  approverName?: string;
}

export interface CreditNote {
  creditNoteId: string;
  creditNoteNumber: string;
  accountId: string;
  returnOrderId?: string;
  claimId?: string;
  status: string;
  amount: number;
  availableAmount?: number;
  usedAmount?: number;
  createdDate?: string;
  type?: string;
}

export interface ReturnOrder {
  returnId: string;
  returnNumber: string;
  accountId: string;
  orderId?: string;
  status: string;
  grandTotal: number;
  reverseSchemeAmount?: number;
  finalAmount?: number;
  description?: string;
  type?: string;
  items: ReturnOrderItem[];
}

export interface ReturnOrderItem {
  itemId: string;
  productId: string;
  productName: string;
  quantity: number;
  goodQuantity: number;
  defectiveQuantity: number;
  totalAmount: number;
}

export interface Claim {
  claimId: string;
  claimNumber: string;
  accountId: string;
  orderId?: string;
  returnOrderId?: string;
  claimType: string;
  status: string;
  amount: number;
  totalAmount: number;
  notes?: string;
}

export interface DMSInvoice {
  invoiceId: string;
  invoiceNumber: string;
  accountId: string;
  orderId?: string;
  status: string;
  totalAmount: number;
  invoiceDate?: string;
  dueDate?: string;
  paymentStatus?: string;
  type?: string;
  fullPartial?: string;
}

export interface DispatchRequest {
  dispatchId: string;
  dispatchName: string;
  orderId?: string;
  status: string;
  invoiceId?: string;
  startDate?: string;
  endDate?: string;
  sourceAddress?: string;
  destinationAddress?: string;
}

export interface InventoryBatch {
  batchId: string;
  productId: string;
  distributorId: string;
  expiryDate?: string;
  manufactureDate?: string;
  status: string;
}

export interface SchemeInfo {
  schemeId: string;
  storeId: string;
  promotionId: string;
  status: string;
  startDate: string;
  endDate: string;
  participationRate?: string;
  slabs: SchemeSlab[];
}

export interface SchemeSlab {
  slabId: string;
  slabNumber: number;
  discountType: string;
  discount: number;
  buyValueFrom: number;
  buyValueTo: number;
  flatAmount: number;
  freeQty: number;
  productCode: string;
  productName: string;
}

export interface ArsSettings {
  autoReplenishmentEnabled: boolean;
  minThreshold: number;
  maxThreshold: number;
  replenishmentFrequency: 'daily' | 'weekly' | 'monthly';
  products: ArsProductSetting[];
}

export interface ArsProductSetting {
  productId: string;
  productName: string;
  currentStock: number;
  minThreshold: number;
  maxThreshold: number;
  reorderPoint: number;
  reorderQuantity: number;
}

// -- Secondary Order Types --
export interface SecondaryOrder {
  orderId: string;
  orderNumber: string;
  distributorId: string;
  retailerCustomer: string;
  status: string;
  totalAmount: number;
  fulfillmentStatus: string;
  invoiceStatus: string;
  dispatchStatus: string;
  orderDate: string;
  items: SecondaryOrderItem[];
  requestedDeliveryDate?: string;
  type?: string;
}

export interface SecondaryOrderItem {
  itemId: string;
  productId: string;
  productName: string;
  orderedQuantity: number;
  availableQuantity: number;
  fulfilledQuantity: number;
  pendingQuantity: number;
  unitPrice: number;
  unitOfMeasure: string;
}

export interface SecondaryOrderDetail extends SecondaryOrder {
  invoiceIds: string[];
  dispatchIds: string[];
  grnIds: string[];
  canCreateInvoice: boolean;
  canUpdateDispatch: boolean;
  hasPendingDispatch: boolean;
  sourceAddress: string;
  destinationAddress: string;
  remainingQtys: Array<{ productId: string; productName: string; orderedQty: number; remainingQty: number }>;
}

export interface FulfillmentResult {
  invoiceId: string;
  invoiceNumber: string;
  dispatchId: string;
  orderStatus: string;
  items: Array<{ productId: string; productName: string; fulfilledQty: number; remainingQty: number }>;
  isFull: boolean;
}

export interface InventoryAvailability {
  productId: string;
  productName: string;
  orderedQuantity: number;
  availableQuantity: number;
  batchDetails: Array<{ batchId: string; quantity: number; expiryDate?: string }>;
}

export interface InvoicePayload {
  items: Array<{ productId: string; quantity: number }>;
  fullOrPartial: 'full' | 'partial';
  notes: string;
}

export interface SecondaryOrderGRN {
  grnId: string;
  grnNumber: string;
  secondaryOrderId: string;
  status: string;
  items: Array<{ productId: string; receivedQuantity: number }>;
}

// -- ARS Types --
export interface ArsConfig {
  autoReplenishmentEnabled: boolean;
  activeProducts: ArsProduct;
  minThreshold: number;
  maxThreshold: number;
  replenishmentFrequency: string;
  lastModifiedBy: string;
  lastModifiedDate: string;
}

export interface ArsProduct {
  productId: string;
  productName: string;
  currentStock: number;
  minThreshold: number;
  maxThreshold: number;
  reorderPoint: number;
  reorderQuantity: number;
  isActive: boolean;
}

export interface ArsTriggeredOrder {
  orderId: string;
  orderNumber: string;
  productId: string;
  productName: string;
  quantity: number;
  reason: string;
  minThreshold: number;
  maxThreshold: number;
  currentStock: number;
  status: string;
  triggerDate: string;
}

export interface BatchStockPolicy {
  batchId: string;
  batchNumber: string;
  productId: string;
  productName: string;
  availableStock: number;
  minStock: number;
  maxStock: number;
  expiryDate?: string;
  replenishmentStatus: string;
  lastUpdated: string;
}

// -- AI Insight Types --
export interface AIBusinessInsight {
  insightId: string;
  type: 'performance' | 'recommendation' | 'warning' | 'opportunity';
  title: string;
  description: string;
  metric?: string;
  metricValue?: number;
  generatedAt: string;
  actionable: boolean;
}

export interface AIStockRecommendation {
  recommendationId: string;
  productId: string;
  productName: string;
  currentMinThreshold: number;
  currentMaxThreshold: number;
  suggestedMinThreshold: number;
  suggestedMaxThreshold: number;
  reasoning: string;
  confidence: number;
  generatedAt: string;
  applied: boolean;
}

export interface AIUpsellRecommendation {
  recommendationId: string;
  retailerId: string;
  retailerName: string;
  productId: string;
  productName: string;
  opportunityScore: number;
  reason: string;
  estimatedRevenue: number;
}

// -- New ISalesforceClient methods --
export interface ISalesforceClientExtended {
  // Secondary Orders
  getSecondaryOrders(context: ResolvedDistributorContext, correlationId?: string): Promise<SecondaryOrder[]>;
  getSecondaryOrderDetails(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<SecondaryOrderDetail>;
  getInventoryAvailability(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<InventoryAvailability[]>;
  createInvoice(context: ResolvedDistributorContext, secondaryOrderId: string, invoicePayload: InvoicePayload, correlationId?: string): Promise<DMSInvoice>;
  getInvoiceDetails(context: ResolvedDistributorContext, invoiceId: string, correlationId?: string): Promise<DMSInvoice>;
  getDispatchRequests(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<DispatchRequest[]>;
  updateDispatchStatus(context: ResolvedDistributorContext, dispatchRequestId: string, newStatus: string, correlationId?: string): Promise<DispatchRequest>;
  getSecondaryOrderGRN(context: ResolvedDistributorContext, secondaryOrderId: string, correlationId?: string): Promise<SecondaryOrderGRN>;
  getInvoiceLineItems(context: ResolvedDistributorContext, invoiceId: string, correlationId?: string): Promise<Array<{ productId: string; productName: string; quantity: number }>>;
  createGRNFromDelivery(context: ResolvedDistributorContext, orderId: string, invoiceId: string, items: Array<{ productId: string; receivedQty: number; lostQty: number; damagedQty: number }>, correlationId?: string): Promise<{ grnId: string; grnNumber: string }>;

  // ARS
  getARSConfig(context: ResolvedDistributorContext, correlationId?: string): Promise<ArsConfig>;
  updateARSStatus(context: ResolvedDistributorContext, active: boolean, correlationId?: string): Promise<ArsConfig>;
  getBatchWiseStockPolicies(context: ResolvedDistributorContext, correlationId?: string): Promise<BatchStockPolicy[]>;
  getARSTriggeredOrders(context: ResolvedDistributorContext, correlationId?: string): Promise<ArsTriggeredOrder[]>;

  // AI Insights
  getBusinessInsights(context: ResolvedDistributorContext, correlationId?: string): Promise<AIBusinessInsight[]>;
  getStockThresholdRecommendations(context: ResolvedDistributorContext, correlationId?: string): Promise<AIStockRecommendation[]>;
  getUpsellRecommendations(context: ResolvedDistributorContext, correlationId?: string): Promise<AIUpsellRecommendation[]>;
  applyStockThresholdRecommendation(context: ResolvedDistributorContext, recommendationId: string, correlationId?: string): Promise<AIStockRecommendation>;
}
