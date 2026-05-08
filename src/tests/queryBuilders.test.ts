import { describe, it, expect } from 'vitest';
import {
  buildDistributorQuery,
  buildAccountByEmailQuery,
  buildPurchaseOrdersByDistributorQuery,
  buildReturnOrdersByAccountQuery,
  buildClaimsByAccountQuery,
  buildInvoicesByAccountQuery,
  buildProductsQuery,
} from '../salesforce/queryBuilders';

describe('QueryBuilders', () => {
  it('builds distributor query by email', () => {
    const query = buildDistributorQuery('test@example.com');
    expect(query).toContain('FROM Contact');
    expect(query).toContain("test@example.com");
  });

  it('builds account query by email', () => {
    const query = buildAccountByEmailQuery('test@example.com');
    expect(query).toContain('FROM Account');
    expect(query).toContain("test@example.com");
  });

  it('builds purchase orders query', () => {
    const query = buildPurchaseOrdersByDistributorQuery('001MOCK000000001');
    expect(query).toContain('FROM Order');
    expect(query).toContain('AccountId');
    expect(query).toContain("'001MOCK000000001'");
  });

  it('builds return orders query', () => {
    const query = buildReturnOrdersByAccountQuery('001MOCK000000001');
    expect(query).toContain('FROM Return_Order__c');
  });

  it('builds claims query', () => {
    const query = buildClaimsByAccountQuery('001MOCK000000001');
    expect(query).toContain('FROM Claim__c');
  });

  it('builds invoices query', () => {
    const query = buildInvoicesByAccountQuery('001MOCK000000001');
    expect(query).toContain('FROM Invoice__c');
  });

  it('builds products query all', () => {
    const query = buildProductsQuery();
    expect(query).toContain('FROM Product2');
    expect(query).toContain('IsActive = true');
  });

  it('builds products query with IDs', () => {
    const query = buildProductsQuery(['01tMOCK001', '01tMOCK002']);
    expect(query).toContain("'01tMOCK001','01tMOCK002'");
  });

  it('escapes single quotes in email', () => {
    const query = buildDistributorQuery("o'brien@example.com");
    expect(query).toContain("o\\'brien@example.com");
  });

  it('throws on invalid Salesforce ID', () => {
    expect(() => buildPurchaseOrdersByDistributorQuery('<invalid>')).toThrow();
  });
});
