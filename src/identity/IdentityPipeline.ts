import { App } from '@slack/bolt';
import { SlackIdentityService, SlackUserIdentity } from './SlackIdentityService';
import { DistributorResolver } from './DistributorResolver';
import { AuthorizationService } from './AuthorizationService';
import { ResolvedDistributorContext } from '../salesforce/types';
import { IdentityResolutionError, AuthorizationError, AppError } from '../utils/errors';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('IdentityPipeline');

export interface IdentityPipelineResult {
  identity: SlackUserIdentity;
  context: ResolvedDistributorContext;
}

export class IdentityPipeline {
  constructor(
    private identityService: SlackIdentityService,
    private distributorResolver: DistributorResolver,
    private authService: AuthorizationService,
  ) {}

  async resolve(
    slackUserId: string,
    correlationId?: string,
  ): Promise<IdentityPipelineResult> {
    const identity = await this.identityService.resolveUserIdentity(
      slackUserId,
      correlationId,
    );

    const result = await this.distributorResolver.resolveByEmail(
      slackUserId,
      identity.slackTeamId,
      identity.slackEnterpriseId,
      identity.email,
      correlationId,
    );

    if (!result.success) {
      throw result.error;
    }

    const context = this.authService.verifyContextExists(
      result.data,
      slackUserId,
    );

    return { identity, context };
  }

  resolveUserFacingMessage(err: unknown): { text: string; userMessage: string } {
    if (err instanceof IdentityResolutionError || err instanceof AuthorizationError) {
      return {
        text: (err as AppError).userMessage,
        userMessage: (err as AppError).userMessage,
      };
    }

    if (err instanceof AppError) {
      return {
        text: err.userMessage,
        userMessage: err.userMessage,
      };
    }

    const isSlackPlatformError = (err as any)?.code === 'slack_webapi_platform_error';
    logger.error({ err }, 'Unhandled error in identity pipeline');
    return {
      text: 'Something went wrong. Please try again.',
      userMessage: isSlackPlatformError ? 'Something went wrong. Please try again.' : (err instanceof Error ? err.message : String(err)),
    };
  }
}
