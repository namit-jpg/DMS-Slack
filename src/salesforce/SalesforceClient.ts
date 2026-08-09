import { env } from '../config/env';
import { ISalesforceClient } from './types';
import { MockSalesforceClient } from './MockSalesforceClient';
import { SalesforceRestClient } from './SalesforceRestClient';
import { SalesforceAuth } from './SalesforceAuth';
import { getSalesforceCliToken, getCachedOrgInfo } from './SalesforceCliAuth';
import { logger } from '../utils/logger';

let clientInstance: ISalesforceClient | null = null;
let authInstance: SalesforceAuth | null = null;
let mode: 'MOCK' | 'REAL' | 'UNINITIALIZED' = 'UNINITIALIZED';
let currentUsername: string | undefined;
let currentOrgId: string | undefined;

type SalesforceAuthMode = 'OAUTH_PASSWORD' | 'CLIENT_CREDENTIALS';

/**
 * Returns configuration errors without making an OAuth request. Keeping this
 * validation separate makes the serverless authentication gate testable and
 * prevents an accidental fallback to another grant type.
 */
export function getSalesforceAuthConfigurationErrors(
  authMode: SalesforceAuthMode,
  config: {
    clientId?: string;
    clientSecret?: string;
    loginUrl?: string;
    username?: string;
    password?: string;
  },
): string[] {
  const missing: string[] = [];

  if (!config.clientId) missing.push('SALESFORCE_CLIENT_ID');
  if (!config.clientSecret) missing.push('SALESFORCE_CLIENT_SECRET');

  if (authMode === 'OAUTH_PASSWORD') {
    if (!config.username) missing.push('SALESFORCE_USERNAME');
    if (!config.password) missing.push('SALESFORCE_PASSWORD');
    return missing;
  }

  if (config.loginUrl) {
    try {
      const url = new URL(config.loginUrl);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.my.salesforce.com')) {
        missing.push('SALESFORCE_LOGIN_URL (an HTTPS Salesforce My Domain URL)');
      }
    } catch {
      missing.push('SALESFORCE_LOGIN_URL (an HTTPS Salesforce My Domain URL)');
    }
  } else {
    missing.push('SALESFORCE_LOGIN_URL (an HTTPS Salesforce My Domain URL)');
  }

  return missing;
}

export function getClientMode(): 'MOCK' | 'REAL' | 'UNINITIALIZED' {
  return mode;
}
export function getCurrentUsername(): string | undefined { return currentUsername; }
export function getCurrentOrgId(): string | undefined { return currentOrgId; }

export async function verifyAuth(): Promise<boolean> {
  if (env.SALESFORCE_AUTH_MODE === 'SF_CLI') {
    try { await getSalesforceCliToken(); return true; } catch { return false; }
  }
  if (!authInstance) return false;
  try { await authInstance.getToken(); return true; } catch { return false; }
}

export function getSalesforceClient(): ISalesforceClient {
  if (clientInstance) return clientInstance;
  if (env.USE_MOCK_SALESFORCE) {
    logger.info('[SF:RUNTIME] Mode = MOCK');
    mode = 'MOCK';
    clientInstance = new MockSalesforceClient();
    return clientInstance;
  }
  throw new Error('[SF:RUNTIME] USE_MOCK_SALESFORCE=false requires initSalesforceClient() async init');
}

export async function initSalesforceClient(): Promise<ISalesforceClient> {
  if (clientInstance) return clientInstance;

  if (env.USE_MOCK_SALESFORCE) {
    logger.info('[SF:RUNTIME] Mode = MOCK');
    logger.info('[SF:RUNTIME] Using Mock Salesforce Client');
    mode = 'MOCK';
    clientInstance = new MockSalesforceClient();
    return clientInstance;
  }

  logger.info('[SF:RUNTIME] Mode = REAL');
  logger.info(`[SF:RUNTIME] Auth mode: ${env.SALESFORCE_AUTH_MODE}`);

  if (env.SALESFORCE_AUTH_MODE === 'SF_CLI') {
    logger.info('[SF:RUNTIME] Attempting Salesforce CLI authentication...');
    const token = await getSalesforceCliToken();
    const orgInfo = getCachedOrgInfo();
    currentUsername = orgInfo?.username;
    currentOrgId = orgInfo?.orgId;
    logger.info(`[SF:RUNTIME] Username: ${currentUsername || 'N/A'}`);
    logger.info(`[SF:RUNTIME] Org ID: ${currentOrgId || 'N/A'}`);
    logger.info(`[SF:RUNTIME] Instance URL: ${token.instanceUrl}`);

    const auth = new SalesforceAuth(false);
    const client = new SalesforceRestClient(auth);
    (client as any).setCliToken(token);
    mode = 'REAL';
    clientInstance = client;
    return clientInstance;
  }

  if (env.SALESFORCE_AUTH_MODE === 'OAUTH_PASSWORD') {
    const missing = getSalesforceAuthConfigurationErrors('OAUTH_PASSWORD', {
      clientId: env.SALESFORCE_CLIENT_ID,
      clientSecret: env.SALESFORCE_CLIENT_SECRET,
      loginUrl: env.SALESFORCE_LOGIN_URL,
      username: env.SALESFORCE_USERNAME,
      password: env.SALESFORCE_PASSWORD,
    });
    if (missing.length > 0) {
      throw new Error(`[SF:RUNTIME] OAUTH_PASSWORD mode requires: ${missing.join(', ')}`);
    }
    authInstance = new SalesforceAuth(true);
    try { await authInstance.getToken(); } catch (err) {
      throw new Error(`[SF:RUNTIME] Salesforce OAuth failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    mode = 'REAL';
    clientInstance = new SalesforceRestClient(authInstance);
    return clientInstance;
  }

  if (env.SALESFORCE_AUTH_MODE === 'CLIENT_CREDENTIALS') {
    const missing = getSalesforceAuthConfigurationErrors('CLIENT_CREDENTIALS', {
      clientId: env.SALESFORCE_CLIENT_ID,
      clientSecret: env.SALESFORCE_CLIENT_SECRET,
      loginUrl: env.SALESFORCE_LOGIN_URL,
    });
    if (missing.length > 0) {
      throw new Error(`[SF:RUNTIME] CLIENT_CREDENTIALS mode requires: ${missing.join(', ')}`);
    }

    authInstance = new SalesforceAuth(false);
    try { await authInstance.getToken(); } catch (err) {
      throw new Error(`[SF:RUNTIME] Salesforce client-credentials OAuth failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    mode = 'REAL';
    clientInstance = new SalesforceRestClient(authInstance);
    return clientInstance;
  }

  throw new Error(`[SF:RUNTIME] Unsupported SALESFORCE_AUTH_MODE: ${env.SALESFORCE_AUTH_MODE}`);
}

export function resetSalesforceClient(): void {
  clientInstance = null;
  authInstance = null;
  mode = 'UNINITIALIZED';
  currentUsername = undefined;
  currentOrgId = undefined;
}
