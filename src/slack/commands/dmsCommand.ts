import { App } from '@slack/bolt';
import { SLACK_COMMANDS } from '../../config/slackConstants';
import { IdentityPipeline } from '../../identity/IdentityPipeline';
import { InsightsService } from '../../services/InsightsService';
import { ReportsService } from '../../services/ReportsService';
import { buildDashboardView } from '../blocks/dashboardBlocks';
import { buildUserErrorBlocks } from '../blocks/commonBlocks';
import { createChildLogger } from '../../utils/logger';

const logger = createChildLogger('DmsCommand');

export function registerDmsCommand(
  app: App,
  pipeline: IdentityPipeline,
  insightsService: InsightsService,
  reportsService: ReportsService,
) {
  app.command(SLACK_COMMANDS.DMS, async ({ command, ack, respond, context }) => {
    await ack();

    const userId = command.user_id;
    const teamId = command.team_id;
    const correlationId = `cmd-${userId}-${Date.now()}`;

    const log = createChildLogger('DmsCommand', correlationId);
    log.info({ userId, teamId }, '/dms command received');

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

      let reportData;
      try {
        reportData = await reportsService.fetchAllReportData(resolvedCtx);
      } catch {
        reportData = undefined;
      }

      const view = buildDashboardView(identity.displayName, metrics, insights, reportData);
      await respond(view);
    } catch (err) {
      log.error({ err }, 'Error handling /dms command');
      const { userMessage } = pipeline.resolveUserFacingMessage(err);
      await respond({
        text: userMessage,
        blocks: buildUserErrorBlocks(userMessage),
        replace_original: false,
      });
    }
  });
}
