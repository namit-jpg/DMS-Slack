import { createSalesforceServerlessClient } from './salesforce';
import { callSlackWebApi } from './slackApi';
import { env } from './_generated/server';

export interface ConvexSlackIdentity {
  slackUserId: string;
  slackTeamId: string;
  slackEnterpriseId: string | null;
  email: string;
  displayName: string;
}

export interface ConvexDistributorContext {
  slackUserId: string;
  slackTeamId: string;
  slackEnterpriseId: string | null;
  slackEmail: string;
  salesforceAccountId: string;
  accountName: string;
  distributorCode: string | null;
  mappingSource: 'AccountEmail' | 'ContactEmail' | 'PersonAccountEmail' | 'DistributorObject';
  resolvedAt: string;
  isActive: boolean;
  accountType: string;
  businessType: string;
}

export class ConvexIdentityError extends Error {
  constructor(readonly userMessage: string, readonly code: string) {
    super(userMessage);
  }
}

interface SalesforceAccountRecord {
  Id: string;
  Name: string;
  Type?: string;
  IsPartner?: boolean;
  Business_Type__c?: string;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

type DevelopmentIdentityFallback = {
  enabled: string | undefined;
  email: string | undefined;
  slackUserId: string | undefined;
};

// Convex generates a closed Env type from the deployment's last successful
// codegen. These values are deliberately optional so a production deployment
// with no dev fallback settings remains fail-closed.
const deploymentEnv = env as typeof env & {
  readonly ENABLE_DEV_SLACK_IDENTITY_FALLBACK?: string;
  readonly DEV_SLACK_IDENTITY_FALLBACK_EMAIL?: string;
  readonly DEV_SLACK_IDENTITY_FALLBACK_USER_ID?: string;
};

function slackApiErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Transitional dev-only recovery for an Enterprise Grid installation whose
 * bot token cannot read the configured test user's profile. It requires all
 * three deployment settings and is deliberately limited to user_not_found;
 * no Slack-provided account ID or email is ever trusted.
 */
export function developmentFallbackEmail(
  slackUserId: string,
  slackErrorCode: string | null,
  fallback: DevelopmentIdentityFallback,
): string | null {
  if (
    fallback.enabled !== 'true'
    || slackErrorCode !== 'user_not_found'
    || fallback.slackUserId !== slackUserId
    || !fallback.email
  ) return null;
  return fallback.email;
}

export function slackUserInfoArguments(teamId: string, userId: string, sourceTeamId?: string): { user: string; team_id?: string } {
  return {
    user: userId,
    ...(sourceTeamId && sourceTeamId !== teamId ? { team_id: sourceTeamId } : {}),
  };
}

export function contextFromAccount(
  identity: ConvexSlackIdentity,
  account: SalesforceAccountRecord,
  mappingSource: ConvexDistributorContext['mappingSource'],
): ConvexDistributorContext | null {
  if (!account.IsPartner) return null;
  return {
    slackUserId: identity.slackUserId,
    slackTeamId: identity.slackTeamId,
    slackEnterpriseId: identity.slackEnterpriseId,
    slackEmail: identity.email,
    salesforceAccountId: account.Id,
    accountName: account.Name,
    distributorCode: null,
    mappingSource,
    resolvedAt: new Date().toISOString(),
    isActive: true,
    accountType: account.Type ?? 'Unknown',
    businessType: account.Business_Type__c ?? 'Distributor',
  };
}

/**
 * Convex's identity path mirrors the legacy resolution order without retaining
 * a Slack user directory in Convex: Slack user -> Contact.Distributor__c ->
 * partner Account.Email__c. The Salesforce account ID never comes from Slack.
 */
export async function resolveSlackDistributorContext(teamId: string, userId: string, sourceTeamId?: string): Promise<{ identity: ConvexSlackIdentity; context: ConvexDistributorContext }> {
  if (teamId !== env.SLACK_TEAM_ID) throw new ConvexIdentityError('This Slack workspace is not authorized.', 'SLACK_TEAM_MISMATCH');

  // Enterprise Grid bot tokens require the installed child workspace to
  // resolve a member. Authorization remains anchored to teamId above; the
  // inbound sourceTeamId has already been signature-verified and checked
  // against that authorized Grid scope by slackIngress.
  let identity: ConvexSlackIdentity;
  try {
    const userPayload = await callSlackWebApi(env.SLACK_BOT_TOKEN, 'users.info', slackUserInfoArguments(teamId, userId, sourceTeamId));
    const user = record(userPayload.user);
    const profile = record(user.profile);
    const email = stringField(profile.email);
    if (!email) throw new ConvexIdentityError('Your Slack profile needs a verified email address to use DMS.', 'SLACK_EMAIL_MISSING');
    identity = {
      slackUserId: userId,
      slackTeamId: teamId,
      slackEnterpriseId: stringField(record(user.enterprise_user).enterprise_id),
      email,
      displayName: stringField(profile.display_name) ?? stringField(user.real_name) ?? userId,
    };
  } catch (error) {
    const fallbackEmail = developmentFallbackEmail(userId, slackApiErrorCode(error), {
      enabled: deploymentEnv.ENABLE_DEV_SLACK_IDENTITY_FALLBACK,
      email: deploymentEnv.DEV_SLACK_IDENTITY_FALLBACK_EMAIL,
      slackUserId: deploymentEnv.DEV_SLACK_IDENTITY_FALLBACK_USER_ID,
    });
    if (!fallbackEmail) throw error;
    identity = {
      slackUserId: userId,
      slackTeamId: teamId,
      slackEnterpriseId: teamId.startsWith('E') ? teamId : null,
      email: fallbackEmail,
      displayName: 'Development test user',
    };
  }
  const sf = createSalesforceServerlessClient();
  const escapedEmail = escapeSoql(identity.email);

  const contacts = await sf.query<{ Distributor__c?: string }>(
    `SELECT Id, Distributor__c FROM Contact WHERE Email = '${escapedEmail}' AND Distributor__c != null ORDER BY CreatedDate ASC LIMIT 2`,
  );
  if (contacts.records.length > 1) {
    throw new ConvexIdentityError('Your email maps to more than one distributor record. Please contact support.', 'DUPLICATE_CONTACT_MAPPING');
  }
  const distributorId = contacts.records[0]?.Distributor__c;
  if (distributorId) {
    const accounts = await sf.query<SalesforceAccountRecord>(
      `SELECT Id, Name, Type, IsPartner, Business_Type__c FROM Account WHERE Id = '${escapeSoql(distributorId)}' LIMIT 1`,
    );
    const context = accounts.records[0] && contextFromAccount(identity, accounts.records[0], 'ContactEmail');
    if (context) return { identity, context };
  }

  const accounts = await sf.query<SalesforceAccountRecord>(
    `SELECT Id, Name, Type, IsPartner, Business_Type__c FROM Account WHERE Email__c = '${escapedEmail}' ORDER BY CreatedDate ASC LIMIT 2`,
  );
  if (accounts.records.length > 1) {
    throw new ConvexIdentityError('Your email maps to more than one distributor account. Please contact support.', 'DUPLICATE_ACCOUNT_MAPPING');
  }
  const context = accounts.records[0] && contextFromAccount(identity, accounts.records[0], 'AccountEmail');
  if (context) return { identity, context };

  throw new ConvexIdentityError('We could not find an active distributor account for your Slack email.', 'DISTRIBUTOR_NOT_MAPPED');
}

function escapeSoql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
