import { App } from '@slack/bolt';
import { SLACK_APP_HOME } from '../../config/slackConstants';
import { IdentityPipeline } from '../../identity/IdentityPipeline';
import { InsightsService } from '../../services/InsightsService';
import { buildDashboardView } from '../blocks/dashboardBlocks';
import { createChildLogger } from '../../utils/logger';

const logger = createChildLogger('AppHomePublisher');

interface PendingPublish {
  userId: string;
  timestamp: number;
}

const pendingPublishes = new Map<string, PendingPublish>();

export function registerAppHome(
  app: App,
  pipeline: IdentityPipeline,
  insightsService: InsightsService,
) {
  app.event('app_home_opened', async ({ event, client }) => {
    const userId = event.user;
    const now = Date.now();
    const pending = pendingPublishes.get(userId);

    if (pending && now - pending.timestamp < SLACK_APP_HOME.PUBLISH_RATE_LIMIT_MS) {
      logger.debug({ userId }, 'Skipping app home publish — rate limited');
      return;
    }

    pendingPublishes.set(userId, { userId, timestamp: now });

    const correlationId = `home-${userId}-${now}`;
    const log = createChildLogger('AppHomePublisher', correlationId);
    log.info({ userId }, 'App home opened');

    try {
      const { identity, context: resolvedCtx } = await pipeline.resolve(
        userId,
        correlationId,
      );

      const metricsResult = await insightsService.getDashboardMetrics(
        resolvedCtx,
        correlationId,
      );
      const insightsResult = await insightsService.getBusinessInsights(
        resolvedCtx,
        correlationId,
      );

      const metrics = metricsResult.success
        ? metricsResult.data
        : {
            totalOrders: 0,
            totalOrderValue: 0,
            ordersThisMonth: 0,
            ordersThisMonthValue: 0,
            pendingOrders: 0,
            primaryOrders: 0,
            primaryOrderValue: 0,
            primaryOrdersThisMonth: 0,
            primaryPendingOrders: 0,
            secondaryOrders: 0,
            secondaryOrderValue: 0,
            secondaryOrdersThisMonth: 0,
            secondaryPendingOrders: 0,
            pendingReturns: 0,
            openClaims: 0,
            unpaidInvoices: 0,
            inventoryAlerts: 0,
            monthlyGrowthPercent: 0,
          };

      const insights = insightsResult.success ? insightsResult.data : [];

      const view = buildDashboardView(identity.displayName, metrics, insights);

      await client.views.publish({
        user_id: userId,
        view: { type: 'home', ...view },
      });
    } catch (err) {
      log.error({ err }, 'Error publishing app home');
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      try {
        await client.views.publish({
          user_id: userId,
          view: {
            type: 'home',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `:warning: ${userMessage}\n\nPlease try again later or use \`/wd-dms\`.`,
                },
              },
            ],
          },
        });
      } catch {
        // best effort
      }
    }
  });
}

export function publishToAppHome(_app: App, _userId: string, _blocks: unknown[]) {
  logger.debug('publishToAppHome called');
}
