import { SALESFORCE_OBJECTS, SALESFORCE_CUSTOM_OBJECTS, SALESFORCE_FIELD_MAP } from '../config/salesforceObjectMap';

export const OBJECT_MAP = {
  ...SALESFORCE_OBJECTS,
  ...SALESFORCE_CUSTOM_OBJECTS,
} as const;

export const FIELD_MAP = SALESFORCE_FIELD_MAP;

export function getObjectName(key: keyof typeof OBJECT_MAP): string {
  return OBJECT_MAP[key];
}

export function getFieldName(
  objectKey: keyof typeof FIELD_MAP,
  fieldKey: string,
): string {
  const obj = FIELD_MAP[objectKey];
  if (!obj) return fieldKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (obj as any)[fieldKey] || fieldKey;
}

export function buildFieldString(
  objectKey: keyof typeof FIELD_MAP,
): string {
  const obj = FIELD_MAP[objectKey];
  if (!obj) return 'Id, Name';
  return Object.values(obj).join(', ');
}

export const OBJECT_TO_FIELD_MAP_KEY: Record<string, keyof typeof FIELD_MAP> = {
  Account: 'ACCOUNT',
  Contact: 'CONTACT',
  Product2: 'PRODUCT',
  Order: 'PURCHASE_ORDER',
  PurchaseOrder__c: 'PURCHASE_ORDER',
  Purchase_Order_Item__c: 'PURCHASE_ORDER_ITEM',
  Return_Order__c: 'RETURN_ORDER_CUSTOM',
  Return_Order_Line_Item__c: 'RETURN_ORDER_LINE_ITEM_CUSTOM',
  Invoice__c: 'INVOICE_CUSTOM',
  Invoice_Line_Item__c: 'INVOICE_LINE_ITEM_CUSTOM',
  Claim__c: 'CLAIM_CUSTOM',
  GRN__c: 'GRN',
  Dispatch_Request__c: 'DISPATCH_REQUEST',
  Inventory_Batch__c: 'INVENTORY_BATCH',
  StoreScheme__c: 'STORE_SCHEME',
  Scheme_Slab_Target__c: 'SCHEME_SLAB_TARGET',
  SFA_User__c: 'SFA_USER',
};

export const KNOWN_RCG_REST_ENDPOINTS = {
  AUTHENTICATE: '/services/apexrest/SFAuthenticateAPI',
  GET_ACCOUNTS: '/services/apexrest/RCG_AccountsAPI',
  GET_ACCOUNT_DETAILS: '/services/apexrest/RCG_AccountDetailsOnlyAPI',
  GET_PRODUCTS: '/services/apexrest/RCG_GetAllProductsAPI',
  GET_ORDERS_BY_ACCOUNT: '/services/apexrest/RCG_GetOrdersByAccountNameAPI',
  GET_RETURN_ORDERS_BY_ACCOUNT: '/services/apexrest/RCG_GetReturnOrdersByAccountNameAPI',
  GET_INVOICES_BY_ACCOUNT: '/services/apexrest/RCG_GetInvoicesByAccountNameAPI',
  GET_CONTACT_BY_NAME: '/services/apexrest/RCG_GetContactByNameAPI',
  GET_SCHEMES: '/services/apexrest/RCG_SchemesAPI',
  GET_INVENTORY: '/services/apexrest/RCG_InventoryAPI',
  GET_PERFORMANCE: '/services/apexrest/RCG_SFA_PerformanceAPI',
  GET_USER_PERFORMANCE: '/services/apexrest/RCG_SFA_GETUserPerformanceAPI',
  PURCHASE_ORDER: '/services/apexrest/RCG_PurchaseOrderRestController',
  PLACE_ORDER: '/services/apexrest/PlaceOrderComponentControllerWd',
  GET_GRN: '/services/apexrest/GrnController',
  GET_DISPATCH: '/services/apexrest/DispatchController',
  GET_CLAIM: '/services/apexrest/ClaimController',
  CREATE_CLAIM: '/services/apexrest/ClaimCreatorController',
  GET_INVOICE_STATUS: '/services/apexrest/InvoiceStatusController',
  GET_ORDER_LIST: '/services/apexrest/OrderListController',
  GET_ORDER_SUMMARY: '/services/apexrest/OrderSummaryController',
  SECONDARY_INVOICE: '/services/apexrest/SecondaryInvoiceController',
  SECONDARY_INVOICE_CREATE: '/services/apexrest/SecondaryInvoiceCreation',
  INVENTORY_REPLENISHMENT: '/services/apexrest/InventoryReplenishmentController',
  INVENTORY_POLICY: '/services/apexrest/InventoryPolicyController',
  RETURN_ANALYSIS: '/services/apexrest/ReturnAnalysisController',
} as const;

export const DISCOVERED_RCG_REST_ENDPOINTS = {
  GET_PURCHASE_ORDERS_BY_SFA_USER: {
    path: '/services/apexrest/sfa/mobile/getPurchaseOrdersBySFAUser2',
    method: 'GET',
    className: 'PurchaseOrderRest',
    requiresSFAUserId: true,
    returns: 'PurchaseOrderWrapper[]',
    verified: true,
  },
  GET_INVENTORY_DATA: {
    path: '/services/apexrest/sfa/mobile/getInventoryData',
    method: 'GET',
    className: 'RCG_InventoryAPI',
    requiresSFAUserId: false,
    returns: 'StockItemWrapper[] (Inventory__c)',
    verified: true,
  },
  CREATE_PURCHASE_ORDER: {
    path: '/services/apexrest/sfa/mobile/createPurchaseOrder2',
    method: 'POST',
    className: 'RCG_PurchaseOrderRestController',
    requiresSFAUserId: false,
    accepts: '{ Distributor__c, SFA_User__c, items: [{ Product__c, Quantity__c, Unit_Price__c }] }',
    returns: '{ success, PurchaseOrderId }',
    verified: true,
  },
  GET_ALL_SCHEMES: {
    path: '/services/apexrest/sfa/mobile/getAllSchemes',
    method: 'GET',
    className: 'RCG_SchemesAPI',
    requiresSFAUserId: false,
    returns: 'Promotion__c[]',
    verified: true,
  },
} as const;
