import {
  buildSection,
  buildDivider,
  buildHeader,
  buildButton,
  buildContext,
} from './commonBlocks';
import { SLACK_ACTION_IDS } from '../../config/slackConstants';
import type { DashboardMetrics, BusinessInsight } from '../../services/InsightsService';
import type { AllReportData } from '../../services/ReportsService';
import { buildDashboardChartSections } from './reportBlocks';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

type Block = any;

export function buildDashboardView(
  userName: string,
  metrics: DashboardMetrics,
  insights: BusinessInsight[],
  reportData?: AllReportData,
) {
  const blocks: Block[] = [
    buildHeader(`:chart_with_upwards_trend: ${userName}'s Dashboard`),
    buildDivider(),
  ];

  if (reportData) {
    blocks.push(...buildDashboardChartSections(reportData));
  } else {
    blocks.push(
      buildSection(
        `*Monthly Performance*\n` +
          `:package: Orders This Month: *${metrics.ordersThisMonth}* (Rs ${formatCurrency(metrics.ordersThisMonthValue)})\n` +
          `:moneybag: Total Order Value: *Rs ${formatCurrency(metrics.totalOrderValue)}*\n` +
          `:chart_with_upwards_trend: Monthly Growth: *${metrics.monthlyGrowthPercent > 0 ? '+' : ''}${metrics.monthlyGrowthPercent}%*`,
      ),
      buildDivider(),
      buildSection(
        `*Order Type Split*\n` +
          `:pencil: Primary: *${metrics.primaryOrders}* orders | Rs ${formatCurrency(metrics.primaryOrderValue)} | Pending: *${metrics.primaryPendingOrders}*\n` +
          `:twisted_rightwards_arrows: Secondary: *${metrics.secondaryOrders}* orders | Rs ${formatCurrency(metrics.secondaryOrderValue)} | Pending: *${metrics.secondaryPendingOrders}*`,
      ),
      buildDivider(),
      buildSection(
        `*At a Glance*\n` +
          `:hourglass_flowing_sand: Pending Orders: *${metrics.pendingOrders}*\n` +
          `:leftwards_arrow_with_hook: Pending Returns: *${metrics.pendingReturns}*\n` +
          `:memo: Open Claims: *${metrics.openClaims}*\n` +
          `:receipt: Unpaid Invoices: *${metrics.unpaidInvoices}*\n` +
          `:warning: Inventory Alerts: *${metrics.inventoryAlerts}*`,
      ),
      buildDivider(),
      buildSection('*:bulb: Business Insights*'),
      ...insights.slice(0, 3).map((insight) =>
        buildSection(`${insightIcon(insight.type)} *${insight.title}*\n${insight.description}`),
      ),
      buildDivider(),
    );
  }

  blocks.push(
    buildSection('*Quick Actions*'),
    {
      type: 'actions' as const,
      elements: [
        buildButton(':pencil: Create Primary Order', SLACK_ACTION_IDS.SELECT_ORDER_TYPE, 'create_primary', 'primary'),
        buildButton(':clipboard: My Primary Orders', SLACK_ACTION_IDS.VIEW_ORDER_DETAIL, 'my_orders'),
      ],
    },
    {
      type: 'actions' as const,
      elements: [
        buildButton(':twisted_rightwards_arrows: Secondary Orders', 'secondary_orders_menu', 'secondary'),
        buildButton(':receipt: Bulk Secondary Invoice', 'bulk_secondary_invoice', 'bulk_invoice'),
      ],
    },
    {
      type: 'actions' as const,
      elements: [
        buildButton(':leftwards_arrow_with_hook: Returns', 'returns_menu', 'returns'),
        buildButton(':memo: Claims', 'claims_menu', 'claims'),
      ],
    },
    {
      type: 'actions' as const,
      elements: [
        buildButton(':package: Inventory Visibility', 'view_inventory', 'inventory'),
        buildButton(':page_facing_up: Partially Fulfilled', 'view_partial_orders', 'partial'),
      ],
    },
    {
      type: 'actions' as const,
      elements: [
        buildButton(':bar_chart: Business Insights', 'insights_menu', 'insights'),
        buildButton(':gear: ARS Settings', 'ars_menu', 'ars'),
        buildButton(':arrows_counterclockwise: Refresh', 'refresh_insights', 'refresh'),
      ],
    },
    buildDivider(),
    buildContext([`Updated: ${formatDateTime()}`]),
  );

  return { blocks };
}


function insightIcon(type: string): string {
  switch (type) {
    case 'warning':
      return ':warning:';
    case 'success':
      return ':white_check_mark:';
    case 'recommendation':
      return ':star:';
    default:
      return ':information_source:';
  }
}
