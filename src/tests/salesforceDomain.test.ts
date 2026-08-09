import { describe, expect, it, vi } from 'vitest';
import { SalesforceServerlessClient } from '../../convex/salesforce';
import {
  SalesforceDomainError,
  createSalesforceDomain,
} from '../../convex/salesforceDomain';
import type { ResolvedDistributorContext } from '../salesforce/types';

const config = {
  loginUrl: 'https://dms.example.my.salesforce.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
};

function context(overrides: Partial<ResolvedDistributorContext> = {}): ResolvedDistributorContext {
  return {
    slackUserId: 'U123',
    slackTeamId: 'T123',
    slackEnterpriseId: null,
    slackEmail: 'distributor@example.com',
    salesforceAccountId: '001ACCOUNT',
    accountName: 'Test Distributor',
    distributorCode: 'D-001',
    mappingSource: 'AccountEmail',
    resolvedAt: '2026-08-09T00:00:00.000Z',
    isActive: true,
    accountType: 'Distributor',
    businessType: 'Distribution',
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenResponse(): Response {
  return response({
    access_token: 'token',
    instance_url: 'https://instance.example.my.salesforce.com',
  });
}

describe('account-bound Salesforce domain', () => {
  it('exposes a context-free handler surface while scoping primary-order reads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(response({
        done: true,
        totalSize: 1,
        records: [{
          Id: '801ORDER',
          OrderNumber: '00001',
          AccountId: '001ACCOUNT',
          Status: 'Draft',
          EffectiveDate: '2026-08-09',
          TotalAmount: 100,
          Grand_Total__c: 100,
          Discount_Amount__c: 0,
          Credit_Applied__c: 0,
          Tax_Amount__c: 0,
          Approval_Status__c: 'None',
        }],
      }));
    const domain = createSalesforceDomain(context(), {
      client: new SalesforceServerlessClient(config, fetchMock),
    });

    await expect(domain.getPrimaryOrders()).resolves.toMatchObject([
      { orderId: '801ORDER', distributorId: '001ACCOUNT' },
    ]);
    const queryUrl = String(fetchMock.mock.calls[1][0]);
    expect(decodeURIComponent(queryUrl)).toContain("AccountId = '001ACCOUNT'");
    expect(decodeURIComponent(queryUrl)).toContain("Type = 'Primary'");
  });

  it('fails closed before any network call when business writes are disabled', async () => {
    const fetchMock = vi.fn();
    const domain = createSalesforceDomain(context(), {
      client: new SalesforceServerlessClient(config, fetchMock),
      allowBusinessWrites: false,
    });

    await expect(domain.update('Order', '801ORDER', { Status: 'Delivered' }))
      .rejects.toMatchObject({ code: 'BUSINESS_WRITES_DISABLED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proves ownership before a generic update and then sends the PATCH', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(response({ done: true, totalSize: 1, records: [{ Id: '801ORDER' }] }))
      .mockResolvedValueOnce(response(undefined, 204));
    const domain = createSalesforceDomain(context(), {
      client: new SalesforceServerlessClient(config, fetchMock),
      allowBusinessWrites: true,
    });

    await domain.update('Order', '801ORDER', { Status: 'Delivered' });

    const ownershipUrl = decodeURIComponent(String(fetchMock.mock.calls[1][0]));
    expect(ownershipUrl).toContain("Id = '801ORDER'");
    expect(ownershipUrl).toContain("AccountId = '001ACCOUNT'");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'PATCH' });
    expect(String(fetchMock.mock.calls[2][0])).toContain('/sobjects/Order/801ORDER');
  });

  it('rejects a claim linked to another account before creating anything', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(response({ done: true, totalSize: 0, records: [] }));
    const domain = createSalesforceDomain(context(), {
      client: new SalesforceServerlessClient(config, fetchMock),
      allowBusinessWrites: true,
    });

    await expect(domain.createOrUpdateClaim({
      returnOrderId: 'a01FOREIGN',
      claimType: 'Damage',
      amount: 10,
      description: 'Damaged carton',
    })).rejects.toMatchObject({ code: 'ACCOUNT_SCOPE_DENIED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'POST' && String(call[0]).includes('/sobjects/Claim__c'))).toBe(false);
  });

  it('rejects unscoped generic SOQL but permits global product-catalog reads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(response({ done: true, totalSize: 0, records: [] }));
    const domain = createSalesforceDomain(context(), {
      client: new SalesforceServerlessClient(config, fetchMock),
    });

    await expect(domain.query('SELECT Id FROM Order LIMIT 50'))
      .rejects.toMatchObject({ code: 'UNSCOPED_SOQL' });
    await expect(domain.query('SELECT Id FROM Pricebook2 WHERE IsActive = true'))
      .resolves.toMatchObject({ records: [] });
  });

  it('keeps documented Salesforce capability blockers explicit', async () => {
    const domain = createSalesforceDomain(context(), {
      client: new SalesforceServerlessClient(config, vi.fn()),
    });

    await expect(domain.getBusinessInsightsEnhanced()).rejects.toEqual(
      expect.objectContaining<SalesforceDomainError>({ code: 'BLK_009' }),
    );
    await expect(domain.submitForApproval('a01RETURN', 'Unsupported__c'))
      .rejects.toMatchObject({ code: 'APPROVAL_OBJECT_UNSUPPORTED' });
  });
});
