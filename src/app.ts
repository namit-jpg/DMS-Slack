import { App } from '@slack/bolt';
import { env } from './config/env';
import { ISalesforceClient } from './salesforce/types';
import { SlackIdentityService } from './identity/SlackIdentityService';
import { DistributorResolver } from './identity/DistributorResolver';
import { AuthorizationService } from './identity/AuthorizationService';
import { IdentityPipeline } from './identity/IdentityPipeline';
import { InsightsService } from './services/InsightsService';
import { registerDmsCommand } from './slack/commands/dmsCommand';
import { registerAppHome } from './slack/appHome/publishHome';
import { registerAllActions } from './slack/actions/router';
import { createChildLogger } from './utils/logger';

export function createApp(sfClient: ISalesforceClient): App {
  const appLogger = createChildLogger('App');

  const distributorResolver = new DistributorResolver(sfClient);
  const authService = new AuthorizationService(sfClient);

  const insightsService = new InsightsService(sfClient);

  const config: Record<string, unknown> = {};

  if (env.SLACK_SOCKET_MODE) {
    config.socketMode = true;
    config.appToken = env.SLACK_APP_TOKEN;
    appLogger.info('Initializing Slack app in Socket Mode');
  } else {
    config.signingSecret = env.SLACK_SIGNING_SECRET;
    appLogger.info('Initializing Slack app in HTTP Mode');
  }

  const app = new App({
    token: env.SLACK_BOT_TOKEN,
    ...(config as { socketMode: boolean; appToken?: string; signingSecret?: string }),
  });

  const identityService = new SlackIdentityService(app);
  const pipeline = new IdentityPipeline(identityService, distributorResolver, authService);

  registerDmsCommand(app, pipeline, insightsService);
  registerAppHome(app, pipeline, insightsService);
  registerAllActions(app, pipeline, sfClient, insightsService);

  appLogger.info('DMS/SFA Slack App initialized');
  appLogger.info(`Salesforce client mode: ${sfClient.isMock() ? 'MOCK' : 'LIVE'}`);
  appLogger.info(`Slack mode: ${env.SLACK_SOCKET_MODE ? 'Socket Mode' : 'HTTP Receiver'}`);

  return app;
}
