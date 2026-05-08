import { describe, it, expect } from 'vitest';
import { MockSalesforceClient } from '../salesforce/MockSalesforceClient';
import { DistributorResolver } from '../identity/DistributorResolver';
import { AuthorizationService } from '../identity/AuthorizationService';
import { PrimaryOrderService } from '../services/PrimaryOrderService';
import { ReturnOrderService } from '../services/ReturnOrderService';
import { ClaimService } from '../services/ClaimService';
import { GrnService } from '../services/GrnService';
import { InvoiceService } from '../services/InvoiceService';
import { DispatchService } from '../services/DispatchService';
import { ArsService } from '../services/ArsService';
import { InsightsService } from '../services/InsightsService';
import { ResolvedDistributorContext } from '../salesforce/types';
import { isSuccess } from '../utils/result';
import { getDefaultFeatureFlags, isFeatureEnabled } from '../config/featureFlags';

function makeContext(
  overrides: Partial<ResolvedDistributorContext> = {},
): ResolvedDistributorContext {
  return {
    slackUserId: 'U001',
    slackTeamId: 'T001',
    slackEnterpriseId: null,
    slackEmail: 'distributor@demo.com',
    salesforceAccountId: '001MOCK000000001',
    accountName: 'Demo Distributors Ltd',
    distributorCode: null,
    mappingSource: 'AccountEmail',
    resolvedAt: new Date().toISOString(),
    isActive: true,
    accountType: 'Partner',
    businessType: 'Distributor',
    ...overrides,
  };
}

describe('MockSalesforceClient', () => {
  const client = new MockSalesforceClient();

  it('reports as mock', () => {
    expect(client.isMock()).toBe(true);
  });

  it('creates a record and returns an ID', async () => {
    const id = await client.create('PurchaseOrder__c', {
      Distributor__c: '001MOCK000000001',
      Status__c: 'Draft',
    });
    expect(id).toContain('mock_');
  });

  it('queries accounts', async () => {
    const result = await client.query('SELECT Id FROM Account');
    expect(result.records.length).toBeGreaterThan(0);
  });

  it('filters contacts by email', async () => {
    const result = await client.query("SELECT Id FROM Contact WHERE Email = 'mega@demo.com'");
    expect(result.records.length).toBe(1);
  });

  it('filters accounts by email', async () => {
    const result = await client.query("SELECT Id FROM Account WHERE Email__c = 'distributor@demo.com' AND IsPartner = true");
    expect(result.records.length).toBe(1);
  });

  it('returns empty for unknown email', async () => {
    const result = await client.query("SELECT Id FROM Contact WHERE Email = 'unknown@nowhere.com'");
    expect(result.records.length).toBe(0);
  });

  it('returns empty for unknown objects', async () => {
    const result = await client.query('SELECT Id FROM UnknownObject__c');
    expect(result.records.length).toBe(0);
  });
});

describe('DistributorResolver', () => {
  const client = new MockSalesforceClient();
  const resolver = new DistributorResolver(client);

  it('resolves known email via Contact', async () => {
    const result = await resolver.resolveByEmail('U1', 'T1', null, 'distributor@demo.com');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accountName).toBe('Demo Distributors Ltd');
    }
  });

  it('resolves via Contact.Distributor__c', async () => {
    const result = await resolver.resolveByEmail('U2', 'T1', null, 'mega@demo.com');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.salesforceAccountId).toBe('001MOCK000000002');
      expect(result.data.accountName).toBe('Mega Retail Corp');
    }
  });

  it('fails for unknown email', async () => {
    const result = await resolver.resolveByEmail('U3', 'T1', null, 'unknown@nowhere.com');
    expect(result.success).toBe(false);
  });
});

describe('AuthorizationService', () => {
  const client = new MockSalesforceClient();
  const auth = new AuthorizationService(client);

  it('rejects null context', () => {
    expect(() => auth.verifyContextExists(null, 'U001')).toThrow();
  });

  it('accepts valid context', () => {
    const ctx = makeContext();
    const result = auth.verifyContextExists(ctx, 'U001');
    expect(result.salesforceAccountId).toBe('001MOCK000000001');
  });

  it('rejects inactive context', () => {
    const ctx = makeContext({ isActive: false });
    expect(() => auth.verifyContextExists(ctx, 'U001')).toThrow();
  });

  it('allows access to own primary order', async () => {
    const ctx = makeContext();
    await expect(auth.assertCanAccessPrimaryOrder(ctx, 'a01MOCK000000001')).resolves.toBeUndefined();
  });

  it('blocks cross-account primary order access', async () => {
    const ctx = makeContext({ salesforceAccountId: '001MOCK000000002' });
    await expect(auth.assertCanAccessPrimaryOrder(ctx, 'a01MOCK000000001')).rejects.toThrow();
  });

  it('allows access to own return order', async () => {
    const ctx = makeContext();
    await expect(auth.assertCanAccessReturnOrder(ctx, 'a02MOCK000000001')).resolves.toBeUndefined();
  });

  it('blocks cross-account return order access', async () => {
    const ctx = makeContext({ salesforceAccountId: '001MOCK000000002' });
    await expect(auth.assertCanAccessReturnOrder(ctx, 'a02MOCK000000001')).rejects.toThrow();
  });
});

describe('PrimaryOrderService', () => {
  const client = new MockSalesforceClient();
  const service = new PrimaryOrderService(client);

  it('lists orders for a distributor', async () => {
    const result = await service.getOrdersByDistributor(makeContext());
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.length).toBe(2);
    }
  });

  it('creates an order with idempotency', async () => {
    const result = await service.createOrder(
      makeContext(),
      [{ productId: '01tMOCK000000001', quantity: 5 }],
      'idempotent-key-2',
    );
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.orderNumber).toBeDefined();
    }
  });
});

describe('Result utility', () => {
  it('success creates a success result', () => {
    const r = { success: true as const, data: 'test' };
    expect(r.success).toBe(true);
  });

  it('failure creates a failure result', () => {
    const r = { success: false as const, error: new Error('fail') };
    expect(r.success).toBe(false);
  });
});

describe('InsightsService', () => {
  const client = new MockSalesforceClient();
  const service = new InsightsService(client);

  it('returns mock dashboard metrics', async () => {
    const result = await service.getDashboardMetrics(makeContext());
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.totalOrders).toBe(45);
    }
  });

  it('returns mock business insights', async () => {
    const result = await service.getBusinessInsights(makeContext());
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.length).toBeGreaterThan(0);
    }
  });
});

describe('FeatureFlags', () => {
  it('returns default flags', () => {
    const flags = getDefaultFeatureFlags();
    expect(flags.PRIMARY_ORDER_CREATE).toBe(true);
    expect(flags.SCHEME_CALCULATION).toBe(true);
  });

  it('checks feature enabled', () => {
    const flags = getDefaultFeatureFlags();
    expect(isFeatureEnabled(flags, 'PRIMARY_ORDER_CREATE')).toBe(true);
    expect(isFeatureEnabled(flags, 'AI_INSIGHTS')).toBe(true);
  });
});

describe('ReturnOrderService', () => {
  const client = new MockSalesforceClient();
  const service = new ReturnOrderService(client);

  it('lists returns for a distributor', async () => {
    const result = await service.getReturnsByAccount(makeContext());
    expect(isSuccess(result)).toBe(true);
  });
});

describe('InvoiceService', () => {
  const client = new MockSalesforceClient();
  const service = new InvoiceService(client);

  it('lists invoices for a distributor', async () => {
    const result = await service.getInvoicesByAccount(makeContext());
    expect(isSuccess(result)).toBe(true);
  });
});
