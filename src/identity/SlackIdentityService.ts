import { App } from '@slack/bolt';
import { createChildLogger } from '../utils/logger';
import { IdentityResolutionError } from '../utils/errors';

const logger = createChildLogger('SlackIdentityService');

export interface SlackUserIdentity {
  slackUserId: string;
  slackTeamId: string;
  slackEnterpriseId: string | null;
  email: string;
  displayName: string;
}

interface CachedEmailEntry {
  email: string;
  displayName: string;
  slackTeamId: string;
  slackEnterpriseId: string | null;
  fetchedAt: number;
}

export class SlackIdentityService {
  private emailCache = new Map<string, CachedEmailEntry>();
  private cacheTtlMs = 5 * 60 * 1000;

  constructor(private app: App) {}

  async resolveUserIdentity(
    slackUserId: string,
    correlationId?: string,
  ): Promise<SlackUserIdentity> {
    const log = correlationId
      ? createChildLogger('SlackIdentityService', correlationId)
      : logger;

    const cached = this.emailCache.get(slackUserId);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      log.debug({ slackUserId }, 'Using cached Slack identity');
      return {
        slackUserId,
        slackTeamId: cached.slackTeamId,
        slackEnterpriseId: cached.slackEnterpriseId,
        email: cached.email,
        displayName: cached.displayName,
      };
    }

    log.info({ slackUserId }, 'Resolving Slack user identity');

    let userInfo;
    try {
      userInfo = await this.app.client.users.info({ user: slackUserId });
    } catch (err) {
      log.error({ err, slackUserId }, 'Slack users.info API call failed');
      throw IdentityResolutionError.emailNotAvailable();
    }

    if (!userInfo.ok || !userInfo.user) {
      log.error({ slackUserId, ok: userInfo.ok }, 'users.info returned no user');
      throw IdentityResolutionError.emailNotAvailable();
    }

    const profile = userInfo.user.profile;
    const email = profile?.email;

    const enterpriseId = (userInfo.user as any).enterprise_id || null;

    if (!email) {
      log.warn({ slackUserId }, 'Slack user has no email visible');
      throw IdentityResolutionError.emailNotAvailable();
    }

    const displayName = profile?.real_name || userInfo.user.name || 'Unknown';

    this.emailCache.set(slackUserId, {
      email,
      displayName,
      slackTeamId: userInfo.user.team_id || '',
      slackEnterpriseId: enterpriseId,
      fetchedAt: Date.now(),
    });

    log.info({ slackUserId, email }, 'Resolved Slack user identity');

    return {
      slackUserId,
      slackTeamId: userInfo.user.team_id || '',
      slackEnterpriseId: enterpriseId,
      email,
      displayName,
    };
  }

  invalidateCache(slackUserId: string): void {
    this.emailCache.delete(slackUserId);
  }
}
