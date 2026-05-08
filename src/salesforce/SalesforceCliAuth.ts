import { execSync } from 'child_process';
import { createChildLogger } from '../utils/logger';
import { SalesforceAuthToken } from './types';
import { env } from '../config/env';

const logger = createChildLogger('SalesforceCliAuth');

interface SfOrgInfo {
  username: string;
  instanceUrl: string;
  orgId: string;
  alias?: string;
  accessToken: string;
}

let cachedToken: SalesforceAuthToken | null = null;
let cachedOrgInfo: SfOrgInfo | null = null;

function runSfCommand(args: string): string {
  try {
    const sfCommand = process.platform === 'win32' ? 'npx sf' : 'sf';
    return execSync(`${sfCommand} ${args}`, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err: any) {
    if (err.stderr) throw new Error(`sf CLI error: ${err.stderr}`);
    throw new Error(`sf CLI error: ${err.message}`);
  }
}

function discoverOrgInfo(): SfOrgInfo {
  if (env.SALESFORCE_CLI_TARGET_ORG) {
    logger.info(`Using explicit SALESFORCE_CLI_TARGET_ORG: ${env.SALESFORCE_CLI_TARGET_ORG}`);
    return fetchOrgForTarget(env.SALESFORCE_CLI_TARGET_ORG);
  }

  const raw = runSfCommand('org list auth --json');
  const data = JSON.parse(raw);
  const orgs: Array<{
    username: string; instanceUrl: string; orgId: string; alias?: string; accessToken: string;
  }> = data.result || [];

  if (orgs.length === 0) {
    throw new Error('[SF_CLI] No authenticated Salesforce CLI orgs found. Run "sf org login web" first.');
  }

  const keywords = ['rcg', 'dms', 'sfa', 'wd.in', 'warpdrive'];
  let match = orgs.find((o) => o.alias && keywords.some((k) => o.alias!.toLowerCase().includes(k)));
  if (!match) match = orgs.find((o) => o.username && keywords.some((k) => o.username!.toLowerCase().includes(k)));
  if (!match) match = orgs.find((o) => !o.alias?.includes('DevHub'));

  if (!match && orgs.length === 1) match = orgs[0];

  if (!match) {
    logger.error(`[SF_CLI] Found ${orgs.length} authenticated orgs but none match rcg/dms/sfa/wd keywords.`);
    const orgList = orgs.map((o) => `  ${o.username} (${o.alias || 'no alias'})`).join('\n');
    logger.error(`Available orgs:\n${orgList}`);
    throw new Error('[SF_CLI] Set SALESFORCE_CLI_TARGET_ORG in .env to specify which org to use.');
  }

  return match;
}

function fetchOrgForTarget(target: string): SfOrgInfo {
  const raw = runSfCommand(`org display --target-org ${target} --json`);
  const data = JSON.parse(raw);
  const r = data.result;
  return {
    username: r.username,
    instanceUrl: r.instanceUrl,
    orgId: r.orgId || r.id,
    alias: r.alias,
    accessToken: r.accessToken,
  };
}

export async function getSalesforceCliToken(): Promise<SalesforceAuthToken> {
  if (cachedToken && cachedOrgInfo) {
    logger.debug('[SF_CLI] Using cached Salesforce CLI token');
    return cachedToken;
  }

  logger.info('[SF_CLI] Discovering Salesforce CLI org...');
  const orgInfo = discoverOrgInfo();

  if (!orgInfo.accessToken) {
    throw new Error('[SF_CLI] Could not extract access token from Salesforce CLI. Try "sf org login web" and "sf org display".');
  }

  cachedOrgInfo = orgInfo;
  const token: SalesforceAuthToken = {
    accessToken: orgInfo.accessToken,
    instanceUrl: orgInfo.instanceUrl,
    id: orgInfo.orgId,
  };

  cachedToken = token;
  logger.info({
    username: orgInfo.username,
    orgId: orgInfo.orgId,
    instanceUrl: orgInfo.instanceUrl,
  }, '[SF_CLI] Salesforce CLI auth resolved successfully');
  return token;
}

export function getCachedOrgInfo(): SfOrgInfo | null {
  return cachedOrgInfo;
}

export function invalidateCliToken(): void {
  cachedToken = null;
  cachedOrgInfo = null;
}
