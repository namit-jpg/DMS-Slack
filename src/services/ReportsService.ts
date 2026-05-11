import { ISalesforceClient, ResolvedDistributorContext } from '../salesforce/types';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('ReportsService');

export interface MonthlyPerformanceData {
  months: string[];
  orderValues: number[];
  orderCounts: number[];
  totalOrderValue: number;
  totalOrderCount: number;
  pendingOrders: number;
  avgOrderValue: number;
  growthPercent: number;
}

export interface SalesMixData {
  primaryValue: number;
  secondaryValue: number;
  primaryCount: number;
  secondaryCount: number;
}

export interface AgingData {
  bucket02: number;
  bucket35: number;
  bucket5plus: number;
  totalPending: number;
}

export interface ClaimsDashboardData {
  openValue: number;
  approvedValue: number;
  rejectedValue: number;
  openCount: number;
  approvedCount: number;
  rejectedCount: number;
}

export interface InventoryLimitData {
  products: Array<{ name: string; status: string }>;
  statusCounts: Record<string, number>;
}

export interface AllReportData {
  monthly: MonthlyPerformanceData;
  salesMix: SalesMixData;
  aging: AgingData;
  claims: ClaimsDashboardData;
  inventory: InventoryLimitData;
  generatedAt: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getLastNMonthLabels(n: number): string[] {
  const now = new Date();
  const labels: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(`${MONTH_NAMES[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`);
  }
  return labels;
}

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysSince(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export class ReportsService {
  constructor(private sfClient: ISalesforceClient) {}

  async fetchAllReportData(ctx: ResolvedDistributorContext): Promise<AllReportData> {
    if (this.sfClient.isMock()) return this.mockData();

    const accountId = ctx.salesforceAccountId.replace(/'/g, "\\'");

    const [ordersResult, claimsResult, inventoryResult] = await Promise.allSettled([
      this.sfClient.query<{
        EffectiveDate: string;
        Grand_Total__c: number;
        TotalAmount: number;
        Status: string;
        Type: string;
        CreatedDate: string;
      }>(
        `SELECT EffectiveDate, Grand_Total__c, TotalAmount, Status, Type, CreatedDate FROM Order WHERE AccountId = '${accountId}' AND EffectiveDate >= LAST_N_MONTHS:6 ORDER BY EffectiveDate ASC LIMIT 300`,
      ),
      this.sfClient.query<{
        Status__c: string;
        Total_Amount__c: number;
        Amount__c: number;
      }>(
        `SELECT Status__c, Total_Amount__c, Amount__c FROM Claim__c WHERE Account__c = '${accountId}' LIMIT 200`,
      ),
      this.sfClient.query<{
        Id: string;
        Product__r: { Name: string } | null;
        Status__c: string;
      }>(
        `SELECT Id, Product__r.Name, Status__c FROM Inventory_Batch__c WHERE Distributor__c = '${accountId}' LIMIT 100`,
      ),
    ]);

    const orders = ordersResult.status === 'fulfilled' ? ordersResult.value.records : [];
    const claims = claimsResult.status === 'fulfilled' ? claimsResult.value.records : [];
    const inventory = inventoryResult.status === 'fulfilled' ? inventoryResult.value.records : [];

    if (ordersResult.status === 'rejected') logger.warn({ err: ordersResult.reason }, 'Orders query failed');
    if (claimsResult.status === 'rejected') logger.warn({ err: claimsResult.reason }, 'Claims query failed');
    if (inventoryResult.status === 'rejected') logger.warn({ err: inventoryResult.reason }, 'Inventory query failed');

    return {
      monthly: this.processMonthlyPerformance(orders),
      salesMix: this.processSalesMix(orders),
      aging: this.processAging(orders),
      claims: this.processClaims(claims),
      inventory: this.processInventory(inventory),
      generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };
  }

  private processMonthlyPerformance(orders: Array<{ EffectiveDate: string; Grand_Total__c: number; TotalAmount: number; Status: string }>): MonthlyPerformanceData {
    const monthLabels = getLastNMonthLabels(6);
    const now = new Date();
    const monthKeys = monthLabels.map((_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    const valueByMonth: Record<string, number> = {};
    const countByMonth: Record<string, number> = {};
    monthKeys.forEach((k) => { valueByMonth[k] = 0; countByMonth[k] = 0; });

    orders.forEach((o) => {
      const key = getMonthKey(o.EffectiveDate);
      if (valueByMonth[key] !== undefined) {
        valueByMonth[key] += o.Grand_Total__c || o.TotalAmount || 0;
        countByMonth[key]++;
      }
    });

    const orderValues = monthKeys.map((k) => Math.round(valueByMonth[k]));
    const orderCounts = monthKeys.map((k) => countByMonth[k]);
    const totalOrderValue = orderValues.reduce((s, v) => s + v, 0);
    const totalOrderCount = orderCounts.reduce((s, v) => s + v, 0);
    const pendingOrders = orders.filter((o) => o.Status === 'Order Placed' || o.Status === 'Draft').length;
    const avgOrderValue = totalOrderCount > 0 ? Math.round(totalOrderValue / totalOrderCount) : 0;

    const prev = orderValues[orderValues.length - 2] || 0;
    const curr = orderValues[orderValues.length - 1] || 0;
    const growthPercent = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0;

    return { months: monthLabels, orderValues, orderCounts, totalOrderValue, totalOrderCount, pendingOrders, avgOrderValue, growthPercent };
  }

  private processSalesMix(orders: Array<{ Grand_Total__c: number; TotalAmount: number; Type: string }>): SalesMixData {
    let primaryValue = 0, secondaryValue = 0, primaryCount = 0, secondaryCount = 0;
    orders.forEach((o) => {
      const val = o.Grand_Total__c || o.TotalAmount || 0;
      if (o.Type === 'Primary' || !o.Type) { primaryValue += val; primaryCount++; }
      else { secondaryValue += val; secondaryCount++; }
    });
    return { primaryValue: Math.round(primaryValue), secondaryValue: Math.round(secondaryValue), primaryCount, secondaryCount };
  }

  private processAging(orders: Array<{ Status: string; CreatedDate: string }>): AgingData {
    const pending = orders.filter((o) => o.Status === 'Order Placed' || o.Status === 'Draft');
    let bucket02 = 0, bucket35 = 0, bucket5plus = 0;
    pending.forEach((o) => {
      const age = daysSince(o.CreatedDate);
      if (age <= 2) bucket02++;
      else if (age <= 5) bucket35++;
      else bucket5plus++;
    });
    return { bucket02, bucket35, bucket5plus, totalPending: pending.length };
  }

  private processClaims(claims: Array<{ Status__c: string; Total_Amount__c: number; Amount__c: number }>): ClaimsDashboardData {
    let openValue = 0, approvedValue = 0, rejectedValue = 0;
    let openCount = 0, approvedCount = 0, rejectedCount = 0;
    claims.forEach((c) => {
      const val = c.Total_Amount__c || c.Amount__c || 0;
      const status = (c.Status__c || '').toLowerCase();
      if (status.includes('open') || status.includes('pending') || status.includes('submitted')) {
        openValue += val; openCount++;
      } else if (status.includes('approv')) {
        approvedValue += val; approvedCount++;
      } else if (status.includes('reject') || status.includes('cancel')) {
        rejectedValue += val; rejectedCount++;
      } else {
        openValue += val; openCount++;
      }
    });
    return { openValue: Math.round(openValue), approvedValue: Math.round(approvedValue), rejectedValue: Math.round(rejectedValue), openCount, approvedCount, rejectedCount };
  }

  private processInventory(records: Array<{ Product__r: { Name: string } | null; Status__c: string }>): InventoryLimitData {
    const statusCounts: Record<string, number> = {};
    const products = records.map((r) => ({ name: r.Product__r?.Name || 'Unknown', status: r.Status__c || 'Unknown' }));
    products.forEach((p) => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1; });
    return { products: products.slice(0, 15), statusCounts };
  }

  private mockData(): AllReportData {
    return {
      monthly: {
        months: getLastNMonthLabels(6),
        orderValues: [48000, 62000, 55000, 78000, 68000, 84000],
        orderCounts: [8, 10, 9, 13, 11, 14],
        totalOrderValue: 395000,
        totalOrderCount: 65,
        pendingOrders: 4,
        avgOrderValue: 6077,
        growthPercent: 24,
      },
      salesMix: { primaryValue: 290000, secondaryValue: 105000, primaryCount: 48, secondaryCount: 17 },
      aging: { bucket02: 2, bucket35: 1, bucket5plus: 1, totalPending: 4 },
      claims: { openValue: 18500, approvedValue: 42000, rejectedValue: 8000, openCount: 3, approvedCount: 7, rejectedCount: 2 },
      inventory: {
        products: [
          { name: 'Sunflower Oil 5L', status: 'Low' },
          { name: 'Basmati Rice 25kg', status: 'Active' },
          { name: 'Wheat Flour 10kg', status: 'Low' },
          { name: 'Sugar 50kg', status: 'Active' },
          { name: 'Dal Toor 5kg', status: 'Expired' },
        ],
        statusCounts: { Active: 2, Low: 2, Expired: 1 },
      },
      generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    };
  }
}
