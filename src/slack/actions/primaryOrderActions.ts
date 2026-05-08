import { App } from '@slack/bolt';
import { SLACK_ACTION_IDS } from '../../config/slackConstants';
import { IdentityPipeline } from '../../identity/IdentityPipeline';
import { ISalesforceClient } from '../../salesforce/types';
import { createChildLogger } from '../../utils/logger';
import { checkIdempotency, markProcessing, markCompleted } from '../../persistence/idempotencyStore';

const logger = createChildLogger('PrimaryOrderActions');

export function registerPrimaryOrderActions(app: App, pipeline: IdentityPipeline, sfClient: ISalesforceClient) {
  app.action(SLACK_ACTION_IDS.SUBMIT_PRIMARY_ORDER, async ({ ack, body, respond }) => {
    await ack();
    try {
      const userId = body.user.id;
      await pipeline.resolve(userId);
      await respond({ text: 'Please use the product selection flow to create an order. Use "Create Primary Order" from the dashboard.' });
    } catch (err) { const { userMessage } = pipeline.resolveUserFacingMessage(err); await respond({ text: userMessage }); }
  });
}
