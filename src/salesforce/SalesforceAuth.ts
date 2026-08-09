import { env } from '../config/env';
import { createChildLogger } from '../utils/logger';
import { SalesforceError } from '../utils/errors';
import { SalesforceAuthToken } from './types';

const logger = createChildLogger('SalesforceAuth');

export class SalesforceAuth {
  private token: SalesforceAuthToken | null = null;
  private tokenExpiry: Date | null = null;

  constructor(private usePasswordFlow: boolean = false) {}

  async getToken(): Promise<SalesforceAuthToken> {
    if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.token;
    }

    if (this.usePasswordFlow) {
      this.token = await this.authenticateWithPassword();
    } else {
      this.token = await this.authenticateWithClientCredentials();
    }

    this.tokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
    logger.info('Salesforce token refreshed');
    return this.token;
  }

  async revokeToken(): Promise<void> {
    this.token = null;
    this.tokenExpiry = null;
  }

  private async authenticateWithPassword(): Promise<SalesforceAuthToken> {
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', env.SALESFORCE_CLIENT_ID!);
    params.append('client_secret', env.SALESFORCE_CLIENT_SECRET!);
    params.append('username', env.SALESFORCE_USERNAME!);
    params.append('password', `${env.SALESFORCE_PASSWORD!}${env.SALESFORCE_SECURITY_TOKEN || ''}`);

    const response = await fetch(
      `${env.SALESFORCE_LOGIN_URL}/services/oauth2/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      },
    );

    if (!response.ok) {
      logger.error({ status: response.status }, 'Salesforce auth failed');
      throw new SalesforceError('Salesforce authentication failed', {
        userMessage: 'Unable to authenticate with the backend system.',
      });
    }

    const data = (await response.json()) as {
      access_token: string;
      instance_url: string;
      id: string;
      issued_at: string;
      signature: string;
    };

    return {
      accessToken: data.access_token,
      instanceUrl: data.instance_url,
      id: data.id,
      issuedAt: data.issued_at,
      signature: data.signature,
    };
  }

  private async authenticateWithClientCredentials(): Promise<SalesforceAuthToken> {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', env.SALESFORCE_CLIENT_ID!);
    params.append('client_secret', env.SALESFORCE_CLIENT_SECRET!);

    const response = await fetch(
      `${env.SALESFORCE_LOGIN_URL}/services/oauth2/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      },
    );

    if (!response.ok) {
      logger.error({ status: response.status }, 'Salesforce auth failed');
      throw new SalesforceError('Salesforce authentication failed');
    }

    const data = (await response.json()) as {
      access_token: string;
      instance_url: string;
    };

    return {
      accessToken: data.access_token,
      instanceUrl: data.instance_url,
    };
  }
}
