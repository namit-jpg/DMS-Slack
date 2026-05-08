import { ISalesforceClient, ResolvedDistributorContext } from '../salesforce/types';
import { createChildLogger } from '../utils/logger';
import { checkIdempotency, markCompleted } from '../persistence/idempotencyStore';
import { env } from '../config/env';

const logger = createChildLogger('SecondaryOrderPoller');

export class SecondaryOrderPoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastSeen = new Map<string, Set<string>>();
  private onNotification?: (ctx: ResolvedDistributorContext, order: any) => Promise<void>;

  constructor(
    private sfClient: ISalesforceClient,
    private pollIntervalMs = 5 * 60 * 1000,
  ) {}

  start(
    resolveContext: (email: string) => Promise<ResolvedDistributorContext | null>,
    onNotification: (ctx: ResolvedDistributorContext, order: any) => Promise<void>,
  ): void {
    this.onNotification = onNotification;
    if (this.interval) clearInterval(this.interval);
    logger.info({ intervalMs: this.pollIntervalMs }, 'Starting secondary order poller');
    this.interval = setInterval(() => this.poll(resolveContext), this.pollIntervalMs);
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  private async poll(resolveContext: (email: string) => Promise<ResolvedDistributorContext | null>): Promise<void> {
    logger.debug('Polling secondary orders');
    try {
      const knownEmails = env.LIVE_TEST_EMAIL ? [env.LIVE_TEST_EMAIL] : [];
      for (const email of knownEmails) {
        const ctx = await resolveContext(email);
        if (!ctx) continue;
        const orders = await this.sfClient.getSecondaryOrders(ctx);
        const seenOrders = this.lastSeen.get(ctx.salesforceAccountId) || new Set<string>();
        for (const order of orders) {
          const idempotencyKey = `so-notify-${order.orderId}`;
          if (seenOrders.has(order.orderId)) continue;
          const existing = checkIdempotency(idempotencyKey);
          if (existing === 'completed') { seenOrders.add(order.orderId); continue; }
          if (this.onNotification) await this.onNotification(ctx, order);
          markCompleted(idempotencyKey, order);
          seenOrders.add(order.orderId);
        }
        this.lastSeen.set(ctx.salesforceAccountId, seenOrders);
      }
    } catch (err) { logger.error({ err }, 'Secondary order polling error'); }
  }
}
