import {
  SALESFORCE_FIELD_MAP,
  SALESFORCE_CUSTOM_OBJECTS,
} from '../config/salesforceObjectMap';
import { isValidSalesforceId } from '../utils/validation';

export function buildDistributorQuery(email: string): string {
  const F = SALESFORCE_FIELD_MAP.CONTACT;
  const A = SALESFORCE_FIELD_MAP.ACCOUNT;
  const escapedEmail = email.replace(/'/g, "\\'");

  return `
    SELECT ${F.ID}, ${F.EMAIL}, ${F.FIRST_NAME}, ${F.LAST_NAME}, ${F.DISTRIBUTOR}
    FROM Contact
    WHERE ${F.EMAIL} = '${escapedEmail}'
    AND ${F.DISTRIBUTOR} != null
    LIMIT 1
  `
    .replace(/\n/g, ' ')
    .trim();
}

export function buildAccountByEmailQuery(email: string): string {
  const A = SALESFORCE_FIELD_MAP.ACCOUNT;
  const escapedEmail = email.replace(/'/g, "\\'");

  return `
    SELECT ${A.ID}, ${A.NAME}, ${A.TYPE}, ${A.IS_PARTNER}, ${A.BUSINESS_TYPE}, ${A.EMAIL}
    FROM Account
    WHERE ${A.EMAIL} = '${escapedEmail}'
    AND ${A.IS_PARTNER} = true
    LIMIT 2
  `
    .replace(/\n/g, ' ')
    .trim();
}

export function buildAccountByEmailBulkQuery(email: string): string {
  const A = SALESFORCE_FIELD_MAP.ACCOUNT;
  const escapedEmail = email.replace(/'/g, "\\'");

  return `
    SELECT ${A.ID}, ${A.NAME}, ${A.TYPE}, ${A.IS_PARTNER}, ${A.BUSINESS_TYPE}, ${A.EMAIL}
    FROM Account
    WHERE ${A.EMAIL} = '${escapedEmail}'
    AND ${A.IS_PARTNER} = true
    LIMIT 5
  `
    .replace(/\n/g, ' ')
    .trim();
}

export function buildAccountByIdQuery(accountId: string): string {
  if (!isValidSalesforceId(accountId)) {
    throw new Error(`Invalid Salesforce ID: ${accountId}`);
  }
  const A = SALESFORCE_FIELD_MAP.ACCOUNT;
  const escapedId = accountId.replace(/'/g, "\\'");

  return `
    SELECT ${A.ID}, ${A.NAME}, ${A.TYPE}, ${A.IS_PARTNER}, ${A.BUSINESS_TYPE}, ${A.EMAIL}
    FROM Account
    WHERE ${A.ID} = '${escapedId}'
    LIMIT 1
  `
    .replace(/\n/g, ' ')
    .trim();
}

export function buildPurchaseOrdersByDistributorQuery(accountId: string): string {
  if (!isValidSalesforceId(accountId)) {
    throw new Error(`Invalid Salesforce ID: ${accountId}`);
  }
  const PO = SALESFORCE_FIELD_MAP.PURCHASE_ORDER;
  const escapedId = accountId.replace(/'/g, "\\'");

  return `
    SELECT ${PO.ID}, ${PO.NAME}, ${PO.DISTRIBUTOR}, ${PO.STATUS},
           Type, ${PO.ORDER_DATE}, TotalAmount, ${PO.GRAND_TOTAL}, ${PO.TAX_AMOUNT},
           ${PO.DISCOUNT_AMOUNT}, ${PO.APPROVAL_STATUS}, ${PO.NOTES}
    FROM ${SALESFORCE_CUSTOM_OBJECTS.PURCHASE_ORDER}
    WHERE ${PO.DISTRIBUTOR} = '${escapedId}'
    ORDER BY CreatedDate DESC
    LIMIT 50
  `
    .replace(/\n/g, ' ')
    .trim();
}

export function buildReturnOrdersByAccountQuery(accountId: string): string {
  if (!isValidSalesforceId(accountId)) {
    throw new Error(`Invalid Salesforce ID: ${accountId}`);
  }
  const RO = SALESFORCE_FIELD_MAP.RETURN_ORDER_CUSTOM;
  const escapedId = accountId.replace(/'/g, "\\'");

  return `
    SELECT ${RO.ID}, ${RO.NAME}, ${RO.ACCOUNT}, ${RO.STATUS}, ${RO.GRAND_TOTAL},
           ${RO.REVERSE_SCHEME_AMOUNT}, ${RO.FINAL_AMOUNT}, ${RO.DESCRIPTION}, ${RO.TYPE}
    FROM ${SALESFORCE_CUSTOM_OBJECTS.RETURN_ORDER_CUSTOM}
    WHERE ${RO.ACCOUNT} = '${escapedId}'
    ORDER BY CreatedDate DESC
    LIMIT 50
  `
    .replace(/\n/g, ' ')
    .trim();
}

export function buildClaimsByAccountQuery(accountId: string): string {
  if (!isValidSalesforceId(accountId)) {
    throw new Error(`Invalid Salesforce ID: ${accountId}`);
  }
  const C = SALESFORCE_FIELD_MAP.CLAIM_CUSTOM;
  const escapedId = accountId.replace(/'/g, "\\'");

  return `
    SELECT ${C.ID}, ${C.NAME}, ${C.ACCOUNT}, ${C.CLAIM_TYPE}, ${C.STATUS},
           ${C.AMOUNT}, ${C.TOTAL_AMOUNT}, ${C.NOTES}, ${C.CLAIM_NUMBER}
    FROM ${SALESFORCE_CUSTOM_OBJECTS.CLAIM_CUSTOM}
    WHERE ${C.ACCOUNT} = '${escapedId}'
    ORDER BY CreatedDate DESC
    LIMIT 50
  `
    .replace(/\n/g, ' ')
    .trim();
}

export function buildInvoicesByAccountQuery(accountId: string): string {
  if (!isValidSalesforceId(accountId)) {
    throw new Error(`Invalid Salesforce ID: ${accountId}`);
  }
  const I = SALESFORCE_FIELD_MAP.INVOICE_CUSTOM;
  const escapedId = accountId.replace(/'/g, "\\'");

  return `
    SELECT ${I.ID}, ${I.NAME}, ${I.BILLING_ACCOUNT}, ${I.STATUS}, ${I.TOTAL_AMOUNT},
           ${I.INVOICE_DATE}, ${I.DUE_DATE}, ${I.PAYMENT_STATUS}, ${I.TYPE}
    FROM ${SALESFORCE_CUSTOM_OBJECTS.INVOICE_CUSTOM}
    WHERE ${I.BILLING_ACCOUNT} = '${escapedId}'
    ORDER BY CreatedDate DESC
    LIMIT 50
  `
    .replace(/\n/g, ' ')
    .trim();
}

export function buildProductsQuery(ids?: string[]): string {
  const P = SALESFORCE_FIELD_MAP.PRODUCT;
  const fields = `${P.ID}, ${P.NAME}, ${P.PRODUCT_CODE}, ${P.FAMILY}, ${P.IS_ACTIVE}, ${P.UNIT_OF_MEASURE}, ${P.UNIT_PRICE}, ${P.PACK_SIZE}, ${P.PRODUCT_CATEGORY}, ${P.MIN_ORDER_QTY_PRIMARY}, ${P.MIN_ORDER_QTY_SECONDARY}`;

  if (ids && ids.length > 0) {
    const escapedIds = ids
      .map((id) => `'${id.replace(/'/g, "\\'")}'`)
      .join(',');
    return `SELECT ${fields} FROM Product2 WHERE Id IN (${escapedIds}) AND IsActive = true`.trim();
  }

  return `SELECT ${fields} FROM Product2 WHERE IsActive = true ORDER BY Name LIMIT 100`.trim();
}

export function buildInventoryBatchByDistributorQuery(accountId: string): string {
  if (!isValidSalesforceId(accountId)) {
    throw new Error(`Invalid Salesforce ID: ${accountId}`);
  }
  const IB = SALESFORCE_FIELD_MAP.INVENTORY_BATCH;
  const escapedId = accountId.replace(/'/g, "\\'");

  return `
    SELECT ${IB.ID}, ${IB.PRODUCT}, ${IB.DISTRIBUTOR}, ${IB.EXPIRY_DATE},
           ${IB.MANUFACTURE_DATE}, ${IB.STATUS}
    FROM ${SALESFORCE_CUSTOM_OBJECTS.INVENTORY_BATCH}
    WHERE ${IB.DISTRIBUTOR} = '${escapedId}'
    ORDER BY ${IB.EXPIRY_DATE} ASC
    LIMIT 100
  `
    .replace(/\n/g, ' ')
    .trim();
}

export function buildDispatchByDistributorQuery(accountId: string): string {
  if (!isValidSalesforceId(accountId)) {
    throw new Error(`Invalid Salesforce ID: ${accountId}`);
  }
  const D = SALESFORCE_FIELD_MAP.DISPATCH_REQUEST;
  const escapedId = accountId.replace(/'/g, "\\'");

  return `
    SELECT ${D.ID}, ${D.NAME}, ${D.ORDER}, ${D.STATUS}, ${D.START_DATE},
           ${D.END_DATE}, ${D.SOURCE_ADDRESS}, ${D.DESTINATION_ADDRESS}
    FROM ${SALESFORCE_CUSTOM_OBJECTS.DISPATCH_REQUEST}
    WHERE ${D.ORDER} IN (
      SELECT Id FROM ${SALESFORCE_CUSTOM_OBJECTS.PURCHASE_ORDER}
      WHERE AccountId = '${escapedId}'
    )
    ORDER BY CreatedDate DESC
    LIMIT 50
  `
    .replace(/\n/g, ' ')
    .trim();
}
