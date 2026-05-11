import { AllReportData } from '../../services/ReportsService';
import { buildQuickChartUrl } from '../../utils/quickChart';
import { buildHeader, buildSection, buildDivider, buildButton, buildContext } from './commonBlocks';
import { SLACK_ACTION_IDS } from '../../config/slackConstants';

type Block = any;

function fmt(n: number): string {
  return n.toLocaleString('en-IN');
}

function chartImage(url: string, altText: string): Block {
  return { type: 'image', image_url: url, alt_text: altText };
}

export function buildReportDashboardBlocks(data: AllReportData): Block[] {
  const blocks: Block[] = [
    buildHeader(':bar_chart: Business Insights'),
    buildSection(`*5 Reports* — data as of ${data.generatedAt}`),
    buildDivider(),
  ];

  // ── Report 1: Monthly Order Performance ──
  blocks.push(buildSection('*:chart_with_upwards_trend: Monthly Order Performance*'));
  blocks.push(chartImage(
    buildQuickChartUrl({
      type: 'bar',
      data: {
        labels: data.monthly.months,
        datasets: [{
          label: 'Order Value (Rs)',
          backgroundColor: '#2196F3',
          borderColor: '#1565C0',
          data: data.monthly.orderValues,
        }],
      },
      options: {
        title: { display: true, text: 'Monthly Order Value', fontColor: '#333' },
        scales: { yAxes: [{ ticks: { beginAtZero: true } }] },
        plugins: { datalabels: { display: false } },
      },
    }, 600, 280),
    'Monthly Order Value Chart',
  ));
  blocks.push(buildContext([
    `:moneybag: Total: Rs ${fmt(data.monthly.totalOrderValue)}  |  :package: Orders: ${data.monthly.totalOrderCount}  |  :hourglass: Pending: ${data.monthly.pendingOrders}  |  :chart_with_upwards_trend: Growth: ${data.monthly.growthPercent > 0 ? '+' : ''}${data.monthly.growthPercent}%  |  Avg: Rs ${fmt(data.monthly.avgOrderValue)}`,
  ]));
  blocks.push(buildDivider());

  // ── Report 2: Primary vs Secondary Sales Mix ──
  blocks.push(buildSection('*:twisted_rightwards_arrows: Primary vs Secondary Sales Mix*'));
  blocks.push(chartImage(
    buildQuickChartUrl({
      type: 'doughnut',
      data: {
        labels: [`Primary (${data.salesMix.primaryCount})`, `Secondary (${data.salesMix.secondaryCount})`],
        datasets: [{
          data: [data.salesMix.primaryValue, data.salesMix.secondaryValue],
          backgroundColor: ['#2196F3', '#4CAF50'],
          borderWidth: 2,
        }],
      },
      options: {
        title: { display: true, text: 'Sales Mix by Value (Rs)', fontColor: '#333' },
        plugins: { datalabels: { display: false } },
      },
    }, 500, 280),
    'Primary vs Secondary Sales Mix',
  ));
  blocks.push(buildContext([
    `:blue_circle: Primary: Rs ${fmt(data.salesMix.primaryValue)} (${data.salesMix.primaryCount} orders)  |  :green_circle: Secondary: Rs ${fmt(data.salesMix.secondaryValue)} (${data.salesMix.secondaryCount} orders)`,
  ]));
  blocks.push(buildDivider());

  // ── Report 3: Pending Order Aging ──
  blocks.push(buildSection('*:hourglass_flowing_sand: Pending Order Aging*'));
  blocks.push(chartImage(
    buildQuickChartUrl({
      type: 'bar',
      data: {
        labels: ['0–2 Days', '3–5 Days', '5+ Days'],
        datasets: [{
          label: 'Pending Orders',
          backgroundColor: ['#4CAF50', '#FF9800', '#f44336'],
          data: [data.aging.bucket02, data.aging.bucket35, data.aging.bucket5plus],
        }],
      },
      options: {
        title: { display: true, text: `Pending Order Aging (${data.aging.totalPending} total)`, fontColor: '#333' },
        scales: { yAxes: [{ ticks: { beginAtZero: true, stepSize: 1 } }] },
        plugins: { datalabels: { display: false } },
        legend: { display: false },
      },
    }, 500, 280),
    'Pending Order Aging Chart',
  ));
  blocks.push(buildContext([
    `:green_circle: 0–2 days: ${data.aging.bucket02}  |  :yellow_circle: 3–5 days: ${data.aging.bucket35}  |  :red_circle: 5+ days: ${data.aging.bucket5plus}  |  Total pending: ${data.aging.totalPending}`,
  ]));
  blocks.push(buildDivider());

  // ── Report 4: Claims Dashboard ──
  const totalClaimsValue = data.claims.openValue + data.claims.approvedValue + data.claims.rejectedValue;
  blocks.push(buildSection('*:memo: Claims Dashboard*'));
  if (totalClaimsValue > 0) {
    blocks.push(chartImage(
      buildQuickChartUrl({
        type: 'doughnut',
        data: {
          labels: [
            `Open (${data.claims.openCount})`,
            `Approved (${data.claims.approvedCount})`,
            `Rejected (${data.claims.rejectedCount})`,
          ],
          datasets: [{
            data: [data.claims.openValue, data.claims.approvedValue, data.claims.rejectedValue],
            backgroundColor: ['#FF9800', '#4CAF50', '#f44336'],
            borderWidth: 2,
          }],
        },
        options: {
          title: { display: true, text: 'Claims by Value (Rs)', fontColor: '#333' },
          plugins: { datalabels: { display: false } },
        },
      }, 500, 280),
      'Claims Dashboard Chart',
    ));
  } else {
    blocks.push(buildSection('_No claims data available._'));
  }
  blocks.push(buildContext([
    `:large_orange_circle: Open: Rs ${fmt(data.claims.openValue)} (${data.claims.openCount})  |  :green_circle: Approved: Rs ${fmt(data.claims.approvedValue)} (${data.claims.approvedCount})  |  :red_circle: Rejected: Rs ${fmt(data.claims.rejectedValue)} (${data.claims.rejectedCount})`,
  ]));
  blocks.push(buildDivider());

  // ── Report 5: Inventory Stock Limit ──
  blocks.push(buildSection('*:package: Inventory Stock Status*'));
  const statusEntries = Object.entries(data.inventory.statusCounts);
  if (statusEntries.length > 0) {
    blocks.push(chartImage(
      buildQuickChartUrl({
        type: 'horizontalBar',
        data: {
          labels: statusEntries.map(([s]) => s),
          datasets: [{
            label: 'Batches',
            backgroundColor: statusEntries.map(([s]) =>
              s.toLowerCase().includes('low') ? '#FF9800'
                : s.toLowerCase().includes('exp') ? '#f44336'
                  : '#4CAF50',
            ),
            data: statusEntries.map(([, c]) => c),
          }],
        },
        options: {
          title: { display: true, text: 'Inventory Batches by Status', fontColor: '#333' },
          scales: { xAxes: [{ ticks: { beginAtZero: true, stepSize: 1 } }] },
          plugins: { datalabels: { display: false } },
          legend: { display: false },
        },
      }, 500, 260),
      'Inventory Stock Status Chart',
    ));
  } else {
    blocks.push(buildSection('_No inventory data available._'));
  }
  const lowCount = data.inventory.statusCounts['Low'] || 0;
  const expiredCount = data.inventory.statusCounts['Expired'] || 0;
  const totalBatches = statusEntries.reduce((s, [, c]) => s + c, 0);
  blocks.push(buildContext([
    `:package: Total batches: ${totalBatches}${lowCount > 0 ? `  |  :warning: Low stock: ${lowCount}` : ''}${expiredCount > 0 ? `  |  :x: Expired: ${expiredCount}` : ''}`,
  ]));

  blocks.push(buildDivider());
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Menu', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });

  return blocks;
}
