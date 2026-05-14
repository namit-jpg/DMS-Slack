import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('PartialOrderReminderService');

interface PendingReminder {
  userId: string;
  orderId: string;
  orderNumber: string;
  retailerCustomer: string;
  pendingItemCount: number;
  nextReminderAt: number;
}

export class PartialOrderReminderService {
  private reminders = new Map<string, PendingReminder>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly slackClient: { chat: { postMessage: (args: { channel: string; text: string }) => Promise<void> } };
  private readonly intervalMs: number;

  constructor(
    slackClient: { chat: { postMessage: (args: { channel: string; text: string }) => Promise<void> } },
    intervalMs = 30 * 60 * 1000,
  ) {
    this.slackClient = slackClient;
    this.intervalMs = intervalMs;
  }

  register(orderId: string, userId: string, orderNumber: string, retailerCustomer: string, pendingItemCount: number): void {
    if (pendingItemCount <= 0) {
      this.deregister(orderId);
      return;
    }
    const existing = this.reminders.get(orderId);
    this.reminders.set(orderId, {
      userId, orderId, orderNumber, retailerCustomer, pendingItemCount,
      nextReminderAt: Date.now() + this.intervalMs,
    });
    if (!existing) {
      logger.info({ orderId, userId, pendingItemCount }, 'Partial order reminder registered');
    }
  }

  deregister(orderId: string): void {
    if (this.reminders.delete(orderId)) {
      logger.info({ orderId }, 'Partial order reminder cleared');
    }
  }

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => void this.tick(), 60_000);
    logger.info({ intervalMs: this.intervalMs }, 'PartialOrderReminderService started');
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const [, reminder] of this.reminders) {
      if (now < reminder.nextReminderAt) continue;
      try {
        await this.slackClient.chat.postMessage({
          channel: reminder.userId,
          text: `:warning: *Partial Order Reminder* — Secondary order *${reminder.orderNumber}* for *${reminder.retailerCustomer}* has *${reminder.pendingItemCount}* product(s) with pending quantities. Please process the remaining invoice once stock is available.`,
        });
        reminder.nextReminderAt = now + this.intervalMs;
        logger.info({ orderId: reminder.orderId, userId: reminder.userId }, 'Partial order reminder sent');
      } catch (err) {
        logger.warn({ err, orderId: reminder.orderId }, 'Could not send partial order reminder (DM may be disabled)');
        reminder.nextReminderAt = now + this.intervalMs;
      }
    }
  }
}
