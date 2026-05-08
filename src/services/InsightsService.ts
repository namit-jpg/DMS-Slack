import { ISalesforceClient, ResolvedDistributorContext, PrimaryOrder } from '../salesforce/types';
import { buildPurchaseOrdersByDistributorQuery } from '../salesforce/queryBuilders';
import { createChildLogger } from '../utils/logger';
import { Result, success, failure } from '../utils/result';

const logger = createChildLogger('InsightsService');

export interface DashboardMetrics {
  totalOrders: number;
  totalOrderValue: number;
  ordersThisMonth: number;
  ordersThisMonthValue: number;
  pendingOrders: number;
  primaryOrders: number;
  primaryOrderValue: number;
  primaryOrdersThisMonth: number;
  primaryPendingOrders: number;
  secondaryOrders: number;
  secondaryOrderValue: number;
  secondaryOrdersThisMonth: number;
  secondaryPendingOrders: number;
  pendingReturns: number;
  openClaims: number;
  unpaidInvoices: number;
  inventoryAlerts: number;
  monthlyGrowthPercent: number;
}

export interface BusinessInsight {
  type: 'warning' | 'info' | 'success' | 'recommendation';
  title: string;
  description: string;
  metric?: string;
}

export class InsightsService {
  constructor(private sfClient: ISalesforceClient) {}

  async getDashboardMetrics(
    account: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<Result<DashboardMetrics, Error>> {
    const log = correlationId
      ? createChildLogger('InsightsService', correlationId)
      : logger;

    try {
      if (this.sfClient.isMock()) {
        return success({
          totalOrders: 45,
          totalOrderValue: 285000.00,
          ordersThisMonth: 12,
          ordersThisMonthValue: 75000.00,
          pendingOrders: 3,
          primaryOrders: 34,
          primaryOrderValue: 210000,
          primaryOrdersThisMonth: 9,
          primaryPendingOrders: 2,
          secondaryOrders: 11,
          secondaryOrderValue: 75000,
          secondaryOrdersThisMonth: 3,
          secondaryPendingOrders: 1,
          pendingReturns: 1,
          openClaims: 2,
          unpaidInvoices: 5,
          inventoryAlerts: 2,
          monthlyGrowthPercent: 15.5,
        });
      }

      const ordersResult = await this.sfClient.query<{
        Id: string;
        Status: string;
        Type?: string | null;
        EffectiveDate?: string;
        TotalAmount?: number;
        Grand_Total__c?: number;
      }>(
        buildPurchaseOrdersByDistributorQuery(account.salesforceAccountId),
        correlationId,
      );

      const orders = ordersResult.records;
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

      const thisMonthOrders = orders.filter(
        (o) => (o.EffectiveDate || '') >= startOfMonth,
      );
      const pendingOrders = orders.filter(
        (o) => o.Status === 'Order Placed' || o.Status === 'Draft',
      );
      const primaryOrders = orders.filter((o) => o.Type === 'Primary');
      const secondaryOrders = orders.filter((o) => o.Type === 'Secondary');
      const getOrderValue = (o: { TotalAmount?: number; Grand_Total__c?: number }) =>
        o.TotalAmount || o.Grand_Total__c || 0;
      const isThisMonth = (o: { EffectiveDate?: string }) => (o.EffectiveDate || '') >= startOfMonth;
      const isPending = (o: { Status: string }) => o.Status === 'Order Placed' || o.Status === 'Draft';

      return success({
        totalOrders: orders.length,
        totalOrderValue: orders.reduce((sum, o) => sum + getOrderValue(o), 0),
        ordersThisMonth: thisMonthOrders.length,
        ordersThisMonthValue: thisMonthOrders.reduce((sum, o) => sum + getOrderValue(o), 0),
        pendingOrders: pendingOrders.length,
        primaryOrders: primaryOrders.length,
        primaryOrderValue: primaryOrders.reduce((sum, o) => sum + getOrderValue(o), 0),
        primaryOrdersThisMonth: primaryOrders.filter(isThisMonth).length,
        primaryPendingOrders: primaryOrders.filter(isPending).length,
        secondaryOrders: secondaryOrders.length,
        secondaryOrderValue: secondaryOrders.reduce((sum, o) => sum + getOrderValue(o), 0),
        secondaryOrdersThisMonth: secondaryOrders.filter(isThisMonth).length,
        secondaryPendingOrders: secondaryOrders.filter(isPending).length,
        pendingReturns: 0,
        openClaims: 0,
        unpaidInvoices: 0,
        inventoryAlerts: 0,
        monthlyGrowthPercent: 0,
      });
    } catch (err) {
      log.error({ err }, 'Failed to compute dashboard metrics');
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async getBusinessInsights(
    account: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<Result<BusinessInsight[], Error>> {
    const log = correlationId
      ? createChildLogger('InsightsService', correlationId)
      : logger;

    try {
      if (this.sfClient.isMock()) {
        return success([
          {
            type: 'warning',
            title: 'Low Stock Alert',
            description:
              'Snack Box B is below reorder threshold (current: 5, min: 10). Consider placing a replenishment order.',
            metric: 'Stock: 5 units',
          },
          {
            type: 'info',
            title: 'Monthly Performance',
            description:
              'Your order volume is up 15.5% compared to last month. You have placed 12 orders worth Rs 75,000 this month.',
            metric: '+15.5% MoM',
          },
          {
            type: 'success',
            title: 'Scheme Eligibility',
            description:
              'Based on your current order volume, you are eligible for the Platinum Distributor scheme. Contact your sales rep for details.',
            metric: 'Eligible',
          },
          {
            type: 'recommendation',
            title: 'Fast-Moving Products',
            description:
              'Beverage Pack A and Oil Can D are your top-selling products. Consider increasing stock levels for these items.',
            metric: 'Top 2 SKUs',
          },
        ]);
      }

      const metrics = await this.getDashboardMetrics(account, correlationId);
      if (!metrics.success) return success([]);
      const data = metrics.data;
      return success([
        {
          type: 'info',
          title: 'Primary vs Secondary Mix',
          description:
            `Primary orders: ${data.primaryOrders} worth Rs ${data.primaryOrderValue.toLocaleString('en-IN')}. Secondary orders: ${data.secondaryOrders} worth Rs ${data.secondaryOrderValue.toLocaleString('en-IN')}.`,
          metric: `${data.primaryOrders}/${data.secondaryOrders}`,
        },
        {
          type: data.primaryPendingOrders + data.secondaryPendingOrders > 0 ? 'warning' : 'success',
          title: 'Pending Order Follow-up',
          description:
            `Pending primary orders: ${data.primaryPendingOrders}. Pending secondary orders: ${data.secondaryPendingOrders}.`,
          metric: String(data.primaryPendingOrders + data.secondaryPendingOrders),
        },
      ]);
    } catch (err) {
      log.error({ err }, 'Failed to get business insights');
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
