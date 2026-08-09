import { env } from './_generated/server';

const TOKEN_PATH = '/services/oauth2/token';
const DEFAULT_API_VERSION = 'v62.0';
const REQUEST_TIMEOUT_MS = 8_000;

export interface SalesforceServerlessConfig {
  loginUrl: string;
  clientId: string;
  clientSecret: string;
  apiVersion?: string;
}

export interface SalesforceSecondaryOrder {
  orderId: string;
  orderNumber: string;
  retailerCustomer: string;
  status: string;
  totalAmount: number;
  fulfillmentStatus: string;
  invoiceStatus: string;
  createdAt: string;
}

export interface SalesforceSecondaryOrderReadOptions {
  /**
   * Return every order strictly newer than this `CreatedDate|Id` boundary.
   * The adapter uses an inclusive CreatedDate predicate and filters the exact
   * composite boundary client-side so equal-millisecond IDs cannot be lost.
   */
  afterWatermark?: string;
  /** Read only the newest row when establishing a no-notification seed. */
  newestOnly?: boolean;
}

export interface SalesforceQueryResponse<T> {
  done: boolean;
  totalSize: number;
  records: T[];
  nextRecordsUrl?: string;
}

interface SalesforceToken {
  accessToken: string;
  instanceUrl: string;
  expiresAt: number;
}

export class SalesforceServerlessError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function isSalesforceMyDomainUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.my.salesforce.com');
  } catch {
    return false;
  }
}

export class SalesforceServerlessClient {
  private token: SalesforceToken | null = null;

  constructor(
    private readonly config: SalesforceServerlessConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!isSalesforceMyDomainUrl(config.loginUrl)) {
      throw new SalesforceServerlessError('Client credentials requires a Salesforce My Domain URL', 'INVALID_LOGIN_URL');
    }
  }

  async query<T>(soql: string): Promise<SalesforceQueryResponse<T>> {
    const response = await this.request(`/services/data/${this.apiVersion()}/query/?q=${encodeURIComponent(soql)}`, { method: 'GET' });
    return response.json() as Promise<SalesforceQueryResponse<T>>;
  }

  async queryAll<T>(soql: string): Promise<SalesforceQueryResponse<T>> {
    const first = await this.query<T>(soql);
    const records = [...first.records];
    let nextRecordsUrl = first.nextRecordsUrl;
    let totalSize = first.totalSize;

    while (nextRecordsUrl) {
      const response = await this.request(nextRecordsUrl, { method: 'GET' });
      const page = await response.json() as SalesforceQueryResponse<T>;
      records.push(...page.records);
      totalSize = Math.max(totalSize, page.totalSize);
      nextRecordsUrl = page.nextRecordsUrl;
    }

    return { done: true, totalSize, records };
  }

  async create(objectName: string, body: Record<string, unknown>): Promise<{ id: string; success: boolean }> {
    const response = await this.request(`/services/data/${this.apiVersion()}/sobjects/${encodeURIComponent(objectName)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return response.json() as Promise<{ id: string; success: boolean }>;
  }

  async update(objectName: string, id: string, body: Record<string, unknown>): Promise<void> {
    await this.request(`/services/data/${this.apiVersion()}/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async delete(objectName: string, id: string): Promise<void> {
    await this.request(`/services/data/${this.apiVersion()}/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async describe<T>(objectName: string): Promise<T> {
    const response = await this.request(`/services/data/${this.apiVersion()}/sobjects/${encodeURIComponent(objectName)}/describe`, {
      method: 'GET',
    });
    return response.json() as Promise<T>;
  }

  async getRecord<T>(objectName: string, id: string, fields?: string[]): Promise<T> {
    const fieldQuery = fields && fields.length > 0 ? `?fields=${encodeURIComponent(fields.join(','))}` : '';
    const response = await this.request(`/services/data/${this.apiVersion()}/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}${fieldQuery}`, {
      method: 'GET',
    });
    return response.json() as Promise<T>;
  }

  /**
   * The poller uses the same account predicate as the legacy adapter. The
   * account identifier is supplied only from a configured operational scope,
   * never from a Slack action value.
   */
  async getSecondaryOrdersForAccount(
    salesforceAccountId: string,
    options: SalesforceSecondaryOrderReadOptions = {},
  ): Promise<SalesforceSecondaryOrder[]> {
    if (options.afterWatermark && options.newestOnly) {
      throw new SalesforceServerlessError(
        'A secondary-order read cannot combine afterWatermark and newestOnly',
        'INVALID_SECONDARY_ORDER_READ_OPTIONS',
      );
    }
    const accountId = escapeSoql(salesforceAccountId);
    const watermark = options.afterWatermark
      ? parseSecondaryOrderWatermark(options.afterWatermark)
      : undefined;
    const basePredicate = `(AccountId = '${accountId}' OR Distributor_Account__c = '${accountId}') AND Type = 'Secondary'`;
    const watermarkPredicate = watermark
      ? ` AND CreatedDate >= ${watermark.soqlCreatedAt}`
      : '';
    const orderBy = options.newestOnly
      ? 'ORDER BY CreatedDate DESC, Id DESC LIMIT 1'
      : options.afterWatermark
        ? 'ORDER BY CreatedDate ASC, Id ASC'
        : 'ORDER BY CreatedDate DESC, Id DESC';
    const soql = `SELECT Id, OrderNumber, Status, TotalAmount, Grand_Total__c, EffectiveDate, CreatedDate, Retailer_Account__c, Retailer_Account__r.Name FROM Order WHERE ${basePredicate}${watermarkPredicate} ${orderBy}`;
    const orders = await (options.newestOnly
      ? this.query<{
          Id: string;
          OrderNumber: string;
          Status: string;
          TotalAmount?: number;
          Grand_Total__c?: number;
          EffectiveDate?: string;
          CreatedDate: string;
          Retailer_Account__c?: string;
          Retailer_Account__r?: { Name?: string };
        }>(soql)
      : this.queryAll<{
      Id: string;
      OrderNumber: string;
      Status: string;
      TotalAmount?: number;
      Grand_Total__c?: number;
      EffectiveDate?: string;
      CreatedDate: string;
      Retailer_Account__c?: string;
      Retailer_Account__r?: { Name?: string };
    }>(soql));

    const records = options.afterWatermark
      ? orders.records.filter((order) => secondaryOrderWatermark(order.CreatedDate, order.Id) > options.afterWatermark!)
      : orders.records;

    const missingIds = [...new Set(records
      .filter((order) => !order.Retailer_Account__r?.Name && order.Retailer_Account__c)
      .map((order) => order.Retailer_Account__c as string))];
    const retailerNames = new Map<string, string>();
    if (missingIds.length > 0) {
      for (let offset = 0; offset < missingIds.length; offset += 100) {
        const ids = missingIds.slice(offset, offset + 100).map((id) => `'${escapeSoql(id)}'`).join(',');
        try {
          const accounts = await this.queryAll<{ Id: string; Name: string }>(`SELECT Id, Name FROM Account WHERE Id IN (${ids})`);
          for (const account of accounts.records) retailerNames.set(account.Id, account.Name);
        } catch {
          // A retailer label is display-only. Do not fail reconciliation
          // because an optional relationship lookup is unavailable.
        }
      }
    }

    return records.map((order) => ({
      orderId: order.Id,
      orderNumber: order.OrderNumber,
      retailerCustomer: order.Retailer_Account__r?.Name ?? retailerNames.get(order.Retailer_Account__c ?? '') ?? order.Retailer_Account__c ?? 'Unknown Retailer',
      status: order.Status,
      totalAmount: order.TotalAmount || order.Grand_Total__c || 0,
      fulfillmentStatus: order.Status,
      // The legacy REST client has no dedicated invoice status field in this
      // list query. Preserve its existing empty-string behavior.
      invoiceStatus: '',
      createdAt: order.CreatedDate,
    }));
  }

  private apiVersion(): string {
    const value = this.config.apiVersion ?? DEFAULT_API_VERSION;
    return value.startsWith('v') ? value : `v${value}`;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let token = await this.getToken();
    let response = await this.fetchWithTimeout(`${token.instanceUrl}${path}`, this.withAuth(init, token.accessToken));
    if (response.status === 401) {
      this.token = null;
      token = await this.getToken();
      response = await this.fetchWithTimeout(`${token.instanceUrl}${path}`, this.withAuth(init, token.accessToken));
    }
    if (!response.ok) {
      let code = 'SALESFORCE_REST_ERROR';
      let message = 'Salesforce REST request failed';
      try {
        const payload = await response.clone().json() as Array<{ errorCode?: string; message?: string }>;
        if (Array.isArray(payload) && payload[0]) {
          code = payload[0].errorCode || code;
          if (payload[0].message) message = `${message} [${code}]: ${payload[0].message}`;
        }
      } catch {
        // Do not expose or log an arbitrary response body. The HTTP status and
        // Salesforce error code are sufficient for safe routing/fallbacks.
      }
      throw new SalesforceServerlessError(message, code, response.status);
    }
    return response;
  }

  private withAuth(init: RequestInit, accessToken: string): RequestInit {
    return {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    };
  }

  private async getToken(): Promise<SalesforceToken> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token;
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const response = await this.fetchWithTimeout(`${this.config.loginUrl}${TOKEN_PATH}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    });
    if (!response.ok) throw new SalesforceServerlessError('Salesforce OAuth token exchange failed', 'SALESFORCE_AUTH_ERROR', response.status);
    const payload = await response.json() as { access_token?: string; instance_url?: string };
    if (!payload.access_token || !payload.instance_url) throw new SalesforceServerlessError('Salesforce OAuth response was incomplete', 'SALESFORCE_AUTH_RESPONSE_INVALID');
    this.token = { accessToken: payload.access_token, instanceUrl: payload.instance_url, expiresAt: Date.now() + 55 * 60 * 1000 };
    return this.token;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      throw new SalesforceServerlessError('Salesforce network request failed', 'SALESFORCE_NETWORK_ERROR');
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** The only Salesforce client a Convex handler may instantiate. */
export function createSalesforceServerlessClient(): SalesforceServerlessClient {
  return new SalesforceServerlessClient({
    loginUrl: env.SALESFORCE_LOGIN_URL,
    clientId: env.SALESFORCE_CLIENT_ID,
    clientSecret: env.SALESFORCE_CLIENT_SECRET,
  });
}

function escapeSoql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function secondaryOrderWatermark(createdAt: string, orderId: string): string {
  return `${createdAt}|${orderId}`;
}

function parseSecondaryOrderWatermark(value: string): { soqlCreatedAt: string; orderId: string } {
  const separator = value.lastIndexOf('|');
  const createdAt = separator > 0 ? value.slice(0, separator) : '';
  const orderId = separator > 0 ? value.slice(separator + 1) : '';
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp) || !/^[A-Za-z0-9]{15,18}$/.test(orderId)) {
    throw new SalesforceServerlessError('Secondary-order watermark is invalid', 'INVALID_SECONDARY_ORDER_WATERMARK');
  }
  return { soqlCreatedAt: new Date(timestamp).toISOString(), orderId };
}
