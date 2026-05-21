import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { initSalesforceClient, getClientMode, getCurrentUsername, getCurrentOrgId } from './salesforce/SalesforceClient';
import { DistributorResolver } from './identity/DistributorResolver';
import { SecondaryOrderPoller } from './services/SecondaryOrderPoller';
import { getBlockersByFeature, BLOCKERS } from './salesforce/blockers';
import { getDefaultFeatureFlags } from './config/featureFlags';
import { formatCurrency } from './utils/formatters';

async function main() {
  logger.info('Starting DMS/SFA Slack Application...');
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Log Level: ${env.LOG_LEVEL}`);
  logger.info(`USE_MOCK_SALESFORCE: ${env.USE_MOCK_SALESFORCE}`);

  const sfClient = await initSalesforceClient();

  const { app, reminderService } = createApp(sfClient);

  const healthServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    const diagnostics = {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      clientMode: getClientMode(),
      salesforceInstanceUrl: process.env.SALESFORCE_INSTANCE_URL || 'N/A',
      featureFlags: getDefaultFeatureFlags(),
      blockerCount: BLOCKERS.length,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(diagnostics));
  });
  healthServer.listen(env.PORT);
  logger.info(`Health endpoint with diagnostics running on port ${env.PORT}`);

  if (env.SLACK_SOCKET_MODE) {
    await app.start();
    logger.info('Slack app started in Socket Mode');
  } else {
    await app.start(env.PORT + 1 || 3001);
    logger.info(`Slack app started on port ${env.PORT + 1 || 3001}`);
  }

  reminderService.start();

  const resolver = new DistributorResolver(sfClient);
  const poller = new SecondaryOrderPoller(sfClient, 5 * 60 * 1000);

  poller.start(
    async (email: string) => {
      const result = await resolver.resolveByEmail('SYSTEM', 'SYSTEM', null, email);
      return result.success ? result.data : null;
    },
    async (ctx, order) => {
      logger.info({ orderId: order.orderId, accountId: ctx.salesforceAccountId }, 'New secondary order notification');
      const partialNote = order.fulfillmentStatus === 'Partially Fulfilled' || order.invoiceStatus === 'Partial' ? ' :warning: *PARTIAL*' : '';
      try {
        const salesChannel = process.env.SLACK_SALES_CHANNEL || 'C0B2R9X5D7F';
        await app.client.chat.postMessage({
          channel: salesChannel,
          text: `:twisted_rightwards_arrows: New Secondary Order: *${order.orderNumber}*${partialNote}\nRetailer: ${order.retailerCustomer}\nAmount: Rs ${formatCurrency(order.totalAmount)}\nStatus: ${order.status} | Invoice: ${order.invoiceStatus || 'N/A'} | Fulfillment: ${order.fulfillmentStatus || 'N/A'}`,
        });
      } catch { logger.warn('Could not deliver secondary order notification to #sales'); }
    },
  );

  logger.info('DMS/SFA Slack Application is ready.');
  logger.info(`[SF:RUNTIME] Final client mode: ${getClientMode()}`);

  const shutdown = async () => {
    logger.info('Shutting down...');
    reminderService.stop();
    poller.stop();
    await app.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start application');
  process.exit(1);
});
