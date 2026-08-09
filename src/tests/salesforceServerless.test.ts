import { describe, expect, it, vi } from 'vitest';
import { SalesforceServerlessClient, isSalesforceMyDomainUrl } from '../../convex/salesforce';

const config = {
  loginUrl: 'https://dms.example.my.salesforce.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
};

describe('SalesforceServerlessClient', () => {
  it('uses the client-credentials grant and then calls Salesforce REST with the token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-1', instance_url: 'https://instance.example.my.salesforce.com' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ done: true, totalSize: 0, records: [] }), { status: 200 }));
    const client = new SalesforceServerlessClient(config, fetchMock);

    await expect(client.query<{ Id: string }>('SELECT Id FROM Account LIMIT 1')).resolves.toEqual({ done: true, totalSize: 0, records: [] });
    expect(fetchMock.mock.calls[0][0]).toBe(`${config.loginUrl}/services/oauth2/token`);
    expect(fetchMock.mock.calls[1][0]).toContain('/services/data/v62.0/query/?q=SELECT');
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer token-1' });
  });

  it('refreshes once after a Salesforce 401', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'expired', instance_url: 'https://instance.example.my.salesforce.com' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fresh', instance_url: 'https://instance.example.my.salesforce.com' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ done: true, totalSize: 0, records: [] }), { status: 200 }));
    const client = new SalesforceServerlessClient(config, fetchMock);

    await client.query('SELECT Id FROM Account LIMIT 1');
    expect(fetchMock.mock.calls[3][1]?.headers).toMatchObject({ Authorization: 'Bearer fresh' });
  });

  it('requires a Salesforce My Domain login URL', () => {
    expect(isSalesforceMyDomainUrl('https://dms.example.my.salesforce.com')).toBe(true);
    expect(isSalesforceMyDomainUrl('https://login.salesforce.com')).toBe(false);
    expect(() => new SalesforceServerlessClient({ ...config, loginUrl: 'https://login.salesforce.com' })).toThrow('My Domain');
  });

  it('paginates every secondary order after a composite watermark without a 50-row cap', async () => {
    const oldId = '801000000000001AAA';
    const newId1 = '801000000000002AAA';
    const newId2 = '801000000000003AAA';
    const createdAt = '2026-08-09T10:00:00.000+0000';
    const order = (Id: string, CreatedDate: string) => ({
      Id,
      OrderNumber: Id.slice(-6),
      Status: 'Draft',
      TotalAmount: 100,
      CreatedDate,
      Retailer_Account__r: { Name: 'Retailer A' },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', instance_url: 'https://instance.example.my.salesforce.com' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        done: false,
        totalSize: 3,
        records: [order(oldId, createdAt), order(newId1, createdAt)],
        nextRecordsUrl: '/services/data/v62.0/query/01g-next-page',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        done: true,
        totalSize: 3,
        records: [order(newId2, '2026-08-09T10:01:00.000+0000')],
      }), { status: 200 }));
    const client = new SalesforceServerlessClient(config, fetchMock);

    const result = await client.getSecondaryOrdersForAccount('001000000000001AAA', {
      afterWatermark: `${createdAt}|${oldId}`,
    });

    expect(result.map((item) => item.orderId)).toEqual([newId1, newId2]);
    const firstQuery = decodeURIComponent(String(fetchMock.mock.calls[1][0]));
    expect(firstQuery).toContain('CreatedDate >= 2026-08-09T10:00:00.000Z');
    expect(firstQuery).toContain('ORDER BY CreatedDate ASC, Id ASC');
    expect(firstQuery).not.toContain('LIMIT 50');
    expect(fetchMock.mock.calls[2][0]).toBe('https://instance.example.my.salesforce.com/services/data/v62.0/query/01g-next-page');
  });

  it('reads only the newest row when establishing a seed boundary', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', instance_url: 'https://instance.example.my.salesforce.com' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        done: true,
        totalSize: 1,
        records: [{
          Id: '801000000000003AAA',
          OrderNumber: '0003',
          Status: 'Draft',
          TotalAmount: 100,
          CreatedDate: '2026-08-09T10:01:00.000+0000',
          Retailer_Account__r: { Name: 'Retailer A' },
        }],
      }), { status: 200 }));
    const client = new SalesforceServerlessClient(config, fetchMock);

    await expect(client.getSecondaryOrdersForAccount('001000000000001AAA', { newestOnly: true }))
      .resolves.toHaveLength(1);
    const query = decodeURIComponent(String(fetchMock.mock.calls[1][0]));
    expect(query).toContain('ORDER BY CreatedDate DESC, Id DESC LIMIT 1');
  });

  it('rejects incompatible secondary-order read modes before authentication', async () => {
    const fetchMock = vi.fn();
    const client = new SalesforceServerlessClient(config, fetchMock);

    await expect(client.getSecondaryOrdersForAccount('001000000000001AAA', {
      afterWatermark: '2026-08-09T10:00:00.000+0000|801000000000001AAA',
      newestOnly: true,
    })).rejects.toMatchObject({ code: 'INVALID_SECONDARY_ORDER_READ_OPTIONS' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
