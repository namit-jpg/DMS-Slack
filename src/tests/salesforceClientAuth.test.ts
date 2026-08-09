import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSalesforceAuthConfigurationErrors } from '../salesforce/SalesforceClient';
import { SalesforceAuth } from '../salesforce/SalesforceAuth';
import { SalesforceRestClient } from '../salesforce/SalesforceRestClient';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Salesforce authentication configuration', () => {
  it('requires only server-to-server credentials for client credentials', () => {
    expect(getSalesforceAuthConfigurationErrors('CLIENT_CREDENTIALS', {
      clientId: 'consumer-key',
      clientSecret: 'consumer-secret',
      loginUrl: 'https://dms.example.my.salesforce.com',
    })).toEqual([]);
  });

  it('rejects login.salesforce.com for client credentials', () => {
    expect(getSalesforceAuthConfigurationErrors('CLIENT_CREDENTIALS', {
      clientId: 'consumer-key',
      clientSecret: 'consumer-secret',
      loginUrl: 'https://login.salesforce.com',
    })).toEqual(['SALESFORCE_LOGIN_URL (an HTTPS Salesforce My Domain URL)']);
  });

  it('reports every missing password-flow requirement', () => {
    expect(getSalesforceAuthConfigurationErrors('OAUTH_PASSWORD', {})).toEqual([
      'SALESFORCE_CLIENT_ID',
      'SALESFORCE_CLIENT_SECRET',
      'SALESFORCE_USERNAME',
      'SALESFORCE_PASSWORD',
    ]);
  });

  it('refreshes an OAuth token once after a Salesforce 401', async () => {
    const auth = new SalesforceAuth(false);
    const getToken = vi.spyOn(auth, 'getToken')
      .mockResolvedValueOnce({ accessToken: 'expired-token', instanceUrl: 'https://dms.example.my.salesforce.com' })
      .mockResolvedValueOnce({ accessToken: 'expired-token', instanceUrl: 'https://dms.example.my.salesforce.com' })
      .mockResolvedValueOnce({ accessToken: 'fresh-token', instanceUrl: 'https://dms.example.my.salesforce.com' });
    const revokeToken = vi.spyOn(auth, 'revokeToken').mockResolvedValue();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('[{\"errorCode\":\"INVALID_SESSION_ID\"}]', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ done: true, records: [], totalSize: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SalesforceRestClient(auth);
    await expect(client.query('SELECT Id FROM Account LIMIT 1')).resolves.toMatchObject({
      done: true,
      totalSize: 0,
    });

    expect(revokeToken).toHaveBeenCalledOnce();
    expect(getToken).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer fresh-token' });
  });
});
