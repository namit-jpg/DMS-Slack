import { describe, it, expect, beforeEach } from 'vitest';
import { MockSalesforceClient } from '../salesforce/MockSalesforceClient';
import { DistributorResolver } from '../identity/DistributorResolver';
import { AuthorizationService } from '../identity/AuthorizationService';
import { ResolvedDistributorContext } from '../salesforce/types';
import { IdentityResolutionError, RecordAccessForbiddenError } from '../utils/errors';

describe('DistributorResolver - Email Mapping', () => {
  const client = new MockSalesforceClient();
  const resolver = new DistributorResolver(client);

  const baseArgs: [string, string, string | null, string] = [
    'U001', 'T001', null, 'distributor@demo.com',
  ];

  it('resolves via Contact.Distributor__c path', async () => {
    const result = await resolver.resolveByEmail(...baseArgs);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mappingSource).toBe('ContactEmail');
      expect(result.data.salesforceAccountId).toBe('001MOCK000000001');
      expect(result.data.accountName).toBe('Demo Distributors Ltd');
      expect(result.data.slackUserId).toBe('U001');
      expect(result.data.slackTeamId).toBe('T001');
      expect(result.data.slackEnterpriseId).toBeNull();
      expect(result.data.slackEmail).toBe('distributor@demo.com');
      expect(result.data.businessType).toBe('Distributor');
      expect(result.data.isActive).toBe(true);
      expect(result.data.resolvedAt).toBeDefined();
    }
  });

  it('resolves via Account.Email__c directly', async () => {
    const result = await resolver.resolveByEmail('U002', 'T001', null, 'mega@demo.com');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.salesforceAccountId).toBe('001MOCK000000002');
      expect(result.data.accountName).toBe('Mega Retail Corp');
    }
  });

  it('returns NOT_MAPPED for unknown email', async () => {
    const result = await resolver.resolveByEmail('U003', 'T001', null, 'unknown@nowhere.com');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(IdentityResolutionError);
      expect(result.error.code).toBe('NOT_MAPPED');
      expect(result.error.statusCode).toBe(404);
      expect(result.error.userMessage).toContain('not mapped to a Distributor Account');
    }
  });

  it('returns DUPLICATE_MAPPING for duplicate emails', async () => {
    const result = await resolver.resolveByEmail('U004', 'T001', null, 'duplicate@demo.com');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(IdentityResolutionError);
      expect(result.error.code).toBe('DUPLICATE_MAPPING');
      expect(result.error.statusCode).toBe(409);
      expect(result.error.userMessage).toContain('multiple Distributor Accounts');
    }
  });

  it('sets slackEnterpriseId when provided', async () => {
    const result = await resolver.resolveByEmail('U001', 'T001', 'E999', 'distributor@demo.com');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slackEnterpriseId).toBe('E999');
    }
  });

  it('sets distributorCode to null (not in org)', async () => {
    const result = await resolver.resolveByEmail('U001', 'T001', null, 'distributor@demo.com');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.distributorCode).toBeNull();
    }
  });
});

describe('AuthorizationService - Record Access Checks', () => {
  const client = new MockSalesforceClient();
  const auth = new AuthorizationService(client);

  const makeContext = (accountId: string, isActive = true, email = 'test@demo.com'): ResolvedDistributorContext => ({
    slackUserId: 'U001',
    slackTeamId: 'T001',
    slackEnterpriseId: null,
    slackEmail: email,
    salesforceAccountId: accountId,
    accountName: 'Test Corp',
    distributorCode: null,
    mappingSource: 'AccountEmail',
    resolvedAt: new Date().toISOString(),
    isActive,
    accountType: 'Partner',
    businessType: 'Distributor',
  });

  describe('verifyContextExists', () => {
    it('accepts a valid context', () => {
      const ctx = makeContext('001MOCK000000001');
      const result = auth.verifyContextExists(ctx, 'U001');
      expect(result.salesforceAccountId).toBe('001MOCK000000001');
    });

    it('throws for null context', () => {
      expect(() => auth.verifyContextExists(null, 'U001')).toThrow();
    });

    it('throws for inactive account', () => {
      const ctx = makeContext('001MOCK000000006', false, 'inactive@demo.com');
      expect(() => auth.verifyContextExists(ctx, 'U001')).toThrow(IdentityResolutionError);
    });
  });

  describe('assertCanAccessPrimaryOrder', () => {
    it('allows access to own order', async () => {
      const ctx = makeContext('001MOCK000000001');
      await expect(auth.assertCanAccessPrimaryOrder(ctx, 'a01MOCK000000001')).resolves.toBeUndefined();
    });

    it('blocks cross-account access', async () => {
      const ctx = makeContext('001MOCK000000002');
      await expect(auth.assertCanAccessPrimaryOrder(ctx, 'a01MOCK000000001')).rejects.toThrow(RecordAccessForbiddenError);
    });

    it('blocks invalid ID', async () => {
      const ctx = makeContext('001MOCK000000001');
      await expect(auth.assertCanAccessPrimaryOrder(ctx, '<invalid>')).rejects.toThrow(RecordAccessForbiddenError);
    });
  });

  describe('assertCanAccessReturnOrder', () => {
    it('allows access to own return order', async () => {
      const ctx = makeContext('001MOCK000000001');
      await expect(auth.assertCanAccessReturnOrder(ctx, 'a02MOCK000000001')).resolves.toBeUndefined();
    });

    it('blocks cross-account access', async () => {
      const ctx = makeContext('001MOCK000000002');
      await expect(auth.assertCanAccessReturnOrder(ctx, 'a02MOCK000000001')).rejects.toThrow(RecordAccessForbiddenError);
    });
  });

  describe('assertCanAccessInvoice', () => {
    it('blocks cross-account access to invoice', async () => {
      const ctx = makeContext('001MOCK000000002');
      await expect(auth.assertCanAccessInvoice(ctx, 'a03MOCK000000001')).rejects.toThrow(RecordAccessForbiddenError);
    });
  });

  describe('assertCanAccessDispatchRequest', () => {
    it('blocks cross-account dispatch access', async () => {
      const ctx = makeContext('001MOCK000000002');
      await expect(auth.assertCanAccessDispatchRequest(ctx, 'a01MOCK000000001')).rejects.toThrow(RecordAccessForbiddenError);
    });
  });
});

describe('IdentityResolutionError - User Messages', () => {
  it('notMapped has correct user message', () => {
    const err = IdentityResolutionError.notMapped('test@test.com');
    expect(err.code).toBe('NOT_MAPPED');
    expect(err.userMessage).toContain('not mapped');
    expect(err.userMessage).toContain('admin');
  });

  it('duplicateMapping has correct user message', () => {
    const err = IdentityResolutionError.duplicateMapping('test@test.com', 3);
    expect(err.code).toBe('DUPLICATE_MAPPING');
    expect(err.userMessage).toContain('multiple');
    expect(err.userMessage).toContain('admin');
  });

  it('inactiveAccount has correct user message', () => {
    const err = IdentityResolutionError.inactiveAccount('test@test.com', '001ABC');
    expect(err.code).toBe('INACTIVE_DISTRIBUTOR');
    expect(err.userMessage).toContain('not active');
  });

  it('emailNotAvailable has correct user message', () => {
    const err = IdentityResolutionError.emailNotAvailable();
    expect(err.code).toBe('EMAIL_NOT_AVAILABLE');
    expect(err.userMessage).toContain('users:read.email');
  });
});

describe('RecordAccessForbiddenError', () => {
  it('has correct properties', () => {
    const err = new RecordAccessForbiddenError('PurchaseOrder', 'a01XXX');
    expect(err.code).toBe('UNAUTHORIZED_RECORD_ACCESS');
    expect(err.userMessage).toBe('You do not have access to this record.');
    expect(err.statusCode).toBe(403);
  });
});
