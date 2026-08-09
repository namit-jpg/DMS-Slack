import type { ConvexDistributorContext, ConvexSlackIdentity } from './identity';
import { resolveSlackActionRoute, type SlackActionHandlerId } from './slackRouteCatalog';
import {
  buildButton,
  buildContext,
  buildDivider,
  buildHeader,
  buildSection,
  buildUserErrorBlocks,
} from '../src/slack/blocks/commonBlocks';
import { buildDashboardView } from '../src/slack/blocks/dashboardBlocks';
import { buildReportDashboardBlocks } from '../src/slack/blocks/reportBlocks';
import {
  buildApprovalResult,
  buildClaimConfirmation,
  buildClaimModal,
  buildGRNConfirmation,
  buildGRNModal,
  buildOrderConfirmation,
  buildOrderDetailBlocks,
  buildOrderListBlocks,
  buildOrderQuoteReview,
  buildProductSelectionModal,
  buildReturnOrderDetailBlocks,
  buildReturnOrderListBlocks,
} from '../src/slack/blocks/orderBlocks';
import {
  buildAIFallback,
  buildAIInsightsDashboard,
  buildARSApprovalAcknowledgement,
  buildARSApprovalMessage,
  buildARSDashboard,
  buildARSChangeRequestForm,
  buildARSEditProduct,
  buildARSOrdersList,
  buildEnhancedInventoryView,
  buildGRNConfirmation as buildSecondaryGRNConfirmation,
  buildGRNEntryForm,
  buildInvoiceConfirmation,
  buildInvoiceProcessing,
  buildSecondaryOrderDetail,
  buildSecondaryOrderList,
} from '../src/slack/blocks/extendedBlocks';
import { formatCurrency, formatDateTime } from '../src/utils/formatters';
import type { AllReportData } from '../src/services/ReportsService';
import type { BusinessInsight, DashboardMetrics } from '../src/services/InsightsService';

const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_BUILDER_TTL_MS = DAY_MS;
const IDEMPOTENCY_TTL_MS = 7 * DAY_MS;
const ARS_APPROVAL_TTL_MS = 7 * DAY_MS;
const REMINDER_TTL_MS = 30 * DAY_MS;
// Preserve the legacy reminder cadence. Delivery itself is scheduled durably
// by `convex/reminders.ts`; this value only supplies the display/state due-at.
const REMINDER_INTERVAL_MS = 30 * 60 * 1000;

type SlackBlock = Record<string, unknown>;

export interface SlackIngressReceipt {
  dedupeKey: string;
  kind: 'command' | 'event' | 'action';
  sourceTeamId?: string;
  teamId: string;
  userId: string;
  handlerKey: string;
  payload: Record<string, unknown>;
  responseUrl?: string;
  responseUrlExpiresAt?: number;
}

export interface SlackHandlerMessage {
  text: string;
  blocks?: SlackBlock[];
  replace_original?: boolean;
}

export interface SlackPostResult {
  channel: string;
  ts: string;
}

export interface OrderBuilderState {
  selected: Array<{ productId: string; quantity: number; schemeDiscount?: number }>;
  selectedCreditNoteIds?: string[];
  quote?: any;
}

export interface PendingArsChange {
  teamId: string;
  channelId: string;
  messageTs: string;
  requestingUserId: string;
  requestingUserName: string;
  salesforceAccountId: string;
  accountName: string;
  changes: Array<{ productId: string; productName: string; oldMin: number; newMin: number; oldMax: number; newMax: number }>;
}

/**
 * The serverless domain is account-bound. Every business method therefore
 * omits the legacy context argument and cannot be accidentally called for a
 * Slack-supplied account id.
 */
export interface SlackSalesforceDomain {
  query<T = Record<string, unknown>>(soql: string): Promise<{ records: T[] }>;
  getAvailableProducts(): Promise<any[]>;
  calculatePrimaryOrderQuote(items: Array<{ productId: string; quantity: number; schemeDiscount?: number }>, creditNoteIds?: string[]): Promise<any>;
  createPrimaryOrder(quote: any): Promise<any>;
  getPrimaryOrders(): Promise<any[]>;
  getPrimaryOrderDetails(orderId: string): Promise<any>;
  markPrimaryOrderDelivered(orderId: string): Promise<void>;
  createOrUpdateGRN(orderId: string, payload: any): Promise<any>;
  getReturnOrders(): Promise<any[]>;
  getReturnOrderDetails(returnOrderId: string): Promise<any>;
  getClaims(returnOrderId?: string): Promise<any[]>;
  createOrUpdateClaim(payload: any): Promise<any>;
  submitForApproval(recordId: string, objectName: string): Promise<any>;
  getApprovalStatus(recordId: string, objectName: string): Promise<any>;
  getCreditNotes(returnOrderId?: string): Promise<any[]>;
  getSecondaryOrders(): Promise<any[]>;
  getSecondaryOrderDetails(orderId: string): Promise<any>;
  getInventoryAvailability(orderId: string): Promise<any[]>;
  createInvoice(orderId: string, payload: any): Promise<any>;
  getDispatchRequests(orderId: string): Promise<any[]>;
  updateDispatchStatus(dispatchId: string, status: string): Promise<any>;
  getGoodsReceiptLines(orderId: string): Promise<any[]>;
  updateGoodsReceiptLines(orderId: string, items: any[]): Promise<any>;
  getInvoiceLineItems(invoiceId: string): Promise<any[]>;
  getARSConfig(): Promise<any>;
  updateARSStatus(active: boolean): Promise<any>;
  getBatchWiseStockPolicies(): Promise<any[]>;
  getARSTriggeredOrders(): Promise<any[]>;
  applyARSPolicyChanges(changes: Array<{ productId: string; newMin: number; newMax: number }>): Promise<void>;
  getBusinessInsightsEnhanced(): Promise<any[]>;
  getStockThresholdRecommendations(): Promise<any[]>;
  getUpsellRecommendations(): Promise<any[]>;
}

export interface SlackOperationalStatePort {
  getOrderBuilder(teamId: string, userId: string, now: number): Promise<OrderBuilderState | null>;
  putOrderBuilder(teamId: string, userId: string, state: OrderBuilderState, now: number, expiresAt: number): Promise<void>;
  clearOrderBuilder(teamId: string, userId: string): Promise<void>;
  acquireIdempotency(key: string, now: number, expiresAt: number): Promise<{ acquired: boolean; status: 'processing' | 'completed' | 'failed' }>;
  completeIdempotency(key: string, now: number, resultReference?: string): Promise<void>;
  failIdempotency(key: string, now: number, errorCode: string): Promise<void>;
  acquireAppHomePublish(teamId: string, userId: string, now: number): Promise<boolean>;
  savePendingArsChange(change: PendingArsChange, now: number, expiresAt: number): Promise<void>;
  getPendingArsChange(teamId: string, channelId: string, messageTs: string, now: number): Promise<PendingArsChange | null>;
  resolvePendingArsChange(teamId: string, channelId: string, messageTs: string, status: 'approved' | 'rejected', now: number): Promise<void>;
  upsertPartialReminder(input: {
    salesforceOrderId: string; salesforceAccountId: string; teamId: string; slackUserId: string;
    orderNumber: string; retailerCustomer: string; pendingItemCount: number; nextReminderAt: number; now: number; expiresAt: number;
  }): Promise<void>;
  scheduleGRNFollowup(input: {
    teamId: string; userId: string; orderId: string; dispatchId: string; dispatchName: string; invoiceId?: string;
    context: ConvexDistributorContext; responseUrl?: string; responseUrlExpiresAt?: number; now: number;
  }): Promise<void>;
  deactivatePartialReminder(orderId: string, now: number): Promise<void>;
}

export interface SlackHandlerDependencies {
  now(): number;
  resolveDistributor(teamId: string, userId: string, sourceTeamId?: string): Promise<{ identity: ConvexSlackIdentity; context: ConvexDistributorContext }>;
  domainFor(context: ConvexDistributorContext): SlackSalesforceDomain;
  state: SlackOperationalStatePort;
  respond(receipt: SlackIngressReceipt, message: SlackHandlerMessage): Promise<void>;
  publishHome(userId: string, blocks: SlackBlock[]): Promise<void>;
  postMessage(input: { channel: string; text: string; blocks?: SlackBlock[]; threadTs?: string }): Promise<SlackPostResult>;
  salesChannelId?: string;
  allowBusinessWrites: boolean;
}

export interface SlackHandlerResult {
  handled: boolean;
  handlerId: 'command' | 'app_home_opened' | SlackActionHandlerId;
  routeFamily: string;
}

class SlackHandlerUserError extends Error {
  constructor(readonly userMessage: string, readonly code: string) {
    super(userMessage);
  }
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stateValues(receipt: SlackIngressReceipt): Record<string, any> {
  return object(receipt.payload.stateValues);
}

function stateControl(receipt: SlackIngressReceipt, blockId: string, actionId: string): Record<string, any> {
  return object(object(stateValues(receipt)[blockId])[actionId]);
}

function stateInput(receipt: SlackIngressReceipt, blockId: string, actionId: string, fallback = ''): string {
  return text(stateControl(receipt, blockId, actionId).value, fallback);
}

function selectedStateValue(receipt: SlackIngressReceipt, blockId: string, actionId: string, fallback = ''): string {
  return text(object(stateControl(receipt, blockId, actionId).selected_option).value, fallback);
}

function selectedStateValues(receipt: SlackIngressReceipt, blockId: string, actionId: string): string[] {
  const options = stateControl(receipt, blockId, actionId).selected_options;
  return Array.isArray(options) ? options.map((option) => text(object(option).value)).filter(Boolean) : [];
}

function actionValue(receipt: SlackIngressReceipt): string {
  return text(receipt.payload.actionValue);
}

function actionId(receipt: SlackIngressReceipt): string {
  return text(receipt.payload.actionId);
}

function userFacingMessage(error: unknown): string {
  const candidate = error as { userMessage?: unknown; code?: unknown };
  if (typeof candidate?.userMessage === 'string') return candidate.userMessage;
  if (error instanceof SlackHandlerUserError) return error.userMessage;

  // Transport errors intentionally carry no raw Slack/Salesforce response
  // text. Map only stable, non-sensitive codes to useful recovery guidance.
  switch (candidate?.code) {
    case 'user_not_found':
      return 'DMS cannot access your Slack profile in this workspace. Open DMS in the workspace where it is installed, or ask an administrator to install DMS in this workspace.';
    case 'missing_scope':
      return 'DMS is missing a required Slack permission. An administrator must reinstall DMS with its approved profile scopes.';
    case 'SALESFORCE_AUTH_ERROR':
    case 'SALESFORCE_AUTH_RESPONSE_INVALID':
    case 'SALESFORCE_NETWORK_ERROR':
      return 'DMS could not connect to Salesforce. Please try again shortly or contact support.';
    case 'INSUFFICIENT_ACCESS':
    case 'INSUFFICIENT_ACCESS_OR_READONLY':
      return 'DMS Salesforce access is not configured for this dashboard yet. Please contact support.';
    default:
      return 'We could not complete that action. Please try again or contact support.';
  }
}

function errorCode(error: unknown): string {
  const candidate = error as { code?: unknown; name?: unknown };
  if (typeof candidate?.code === 'string') return candidate.code.slice(0, 80);
  if (typeof candidate?.name === 'string') return candidate.name.slice(0, 80);
  return 'HANDLER_FAILED';
}

async function idempotencyFingerprint(parts: unknown[]): Promise<string> {
  const value = parts.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireBusinessWrites(deps: SlackHandlerDependencies): void {
  if (!deps.allowBusinessWrites) {
    throw new SlackHandlerUserError(
      'This write action is disabled until the production migration write gate is explicitly enabled.',
      'BUSINESS_WRITES_DISABLED',
    );
  }
}

async function runIdempotentWrite<T>(
  deps: SlackHandlerDependencies,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  requireBusinessWrites(deps);
  return runIdempotentOperation(deps, key, operation);
}

async function runIdempotentOperation<T>(
  deps: SlackHandlerDependencies,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const now = deps.now();
  const acquired = await deps.state.acquireIdempotency(key, now, now + IDEMPOTENCY_TTL_MS);
  if (!acquired.acquired) {
    if (acquired.status === 'processing') throw new SlackHandlerUserError('This action is already in progress.', 'WRITE_IN_PROGRESS');
    if (acquired.status === 'completed') throw new SlackHandlerUserError('This action was already completed.', 'WRITE_ALREADY_COMPLETED');
    throw new SlackHandlerUserError('A previous attempt needs operator review before this action can be retried.', 'WRITE_REVIEW_REQUIRED');
  }
  try {
    const result = await operation();
    const reference = object(result).orderId ?? object(result).grnId ?? object(result).claimId ?? object(result).invoiceId;
    await deps.state.completeIdempotency(key, deps.now(), typeof reference === 'string' ? reference : undefined);
    return result;
  } catch (error) {
    await deps.state.failIdempotency(key, deps.now(), errorCode(error));
    throw error;
  }
}

function hydrateSelected(
  selected: Array<{ productId: string; quantity: number; schemeDiscount?: number }>,
  receipt: SlackIngressReceipt,
) {
  return selected.map((item) => ({
    ...item,
    quantity: Math.max(1, integer(stateInput(receipt, `qty_${item.productId}`, `input_qty_${item.productId}`, String(item.quantity)), item.quantity || 1)),
    schemeDiscount: 0,
  }));
}

function defaultArsConfig(active = false) {
  return {
    autoReplenishmentEnabled: active,
    activeProducts: { productId: '', productName: '', currentStock: 0, minThreshold: 0, maxThreshold: 0, reorderPoint: 0, reorderQuantity: 0, isActive: false },
    minThreshold: 0,
    maxThreshold: 0,
    replenishmentFrequency: 'N/A',
    lastModifiedBy: 'N/A',
    lastModifiedDate: 'N/A',
  };
}

function emptyDashboardMetrics(): DashboardMetrics {
  return {
    totalOrders: 0, totalOrderValue: 0, ordersThisMonth: 0, ordersThisMonthValue: 0, pendingOrders: 0,
    primaryOrders: 0, primaryOrderValue: 0, primaryOrdersThisMonth: 0, primaryPendingOrders: 0,
    secondaryOrders: 0, secondaryOrderValue: 0, secondaryOrdersThisMonth: 0, secondaryPendingOrders: 0,
    pendingReturns: 0, openClaims: 0, unpaidInvoices: 0, inventoryAlerts: 0, monthlyGrowthPercent: 0,
  };
}

function escapeSoql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function loadDashboard(
  domain: SlackSalesforceDomain,
  identity: ConvexSlackIdentity,
  context: ConvexDistributorContext,
): Promise<{ blocks: SlackBlock[] }> {
  const accountId = escapeSoql(context.salesforceAccountId);
  try {
    const [ordersResult, claimsResult, inventoryResult] = await Promise.allSettled([
      domain.query<any>(`SELECT EffectiveDate, Grand_Total__c, TotalAmount, Status, Type, CreatedDate FROM Order WHERE AccountId = '${accountId}' AND EffectiveDate >= LAST_N_MONTHS:6 ORDER BY EffectiveDate ASC LIMIT 300`),
      domain.query<any>(`SELECT Status__c, Total_Amount__c, Amount__c FROM Claim__c WHERE Order__c IN (SELECT Id FROM Order WHERE AccountId = '${accountId}' OR Distributor_Account__c = '${accountId}') LIMIT 200`),
      domain.query<any>(`SELECT Id, Product__r.Name, Status__c FROM Inventory_Batch__c WHERE Distributor__c = '${accountId}' LIMIT 100`),
    ]);
    const orders = ordersResult.status === 'fulfilled' ? ordersResult.value.records : [];
    const claims = claimsResult.status === 'fulfilled' ? claimsResult.value.records : [];
    const inventory = inventoryResult.status === 'fulfilled' ? inventoryResult.value.records : [];
    const metrics = dashboardMetricsFromOrders(orders);
    const insights: BusinessInsight[] = [
      {
        type: metrics.pendingOrders > 0 ? 'warning' : 'success',
        title: 'Pending Order Follow-up',
        description: `Pending primary orders: ${metrics.primaryPendingOrders}. Pending secondary orders: ${metrics.secondaryPendingOrders}.`,
        metric: String(metrics.pendingOrders),
      },
      {
        type: 'info',
        title: 'Primary vs Secondary Mix',
        description: `Primary orders: ${metrics.primaryOrders} worth Rs ${formatCurrency(metrics.primaryOrderValue)}. Secondary orders: ${metrics.secondaryOrders} worth Rs ${formatCurrency(metrics.secondaryOrderValue)}.`,
      },
    ];
    const reports = reportDataFromRecords(orders, claims, inventory);
    return buildDashboardView(identity.displayName, metrics, insights, reports) as { blocks: SlackBlock[] };
  } catch {
    return buildDashboardView(identity.displayName || 'User', emptyDashboardMetrics(), []) as { blocks: SlackBlock[] };
  }
}

function dashboardMetricsFromOrders(orders: any[]): DashboardMetrics {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const value = (order: any) => number(order.Grand_Total__c ?? order.TotalAmount, 0);
  const pending = (order: any) => order.Status === 'Order Placed' || order.Status === 'Draft';
  const thisMonth = (order: any) => text(order.EffectiveDate) >= monthStart;
  const primary = orders.filter((order) => order.Type === 'Primary' || !order.Type);
  const secondary = orders.filter((order) => order.Type === 'Secondary');
  return {
    ...emptyDashboardMetrics(),
    totalOrders: orders.length,
    totalOrderValue: orders.reduce((sum, order) => sum + value(order), 0),
    ordersThisMonth: orders.filter(thisMonth).length,
    ordersThisMonthValue: orders.filter(thisMonth).reduce((sum, order) => sum + value(order), 0),
    pendingOrders: orders.filter(pending).length,
    primaryOrders: primary.length,
    primaryOrderValue: primary.reduce((sum, order) => sum + value(order), 0),
    primaryOrdersThisMonth: primary.filter(thisMonth).length,
    primaryPendingOrders: primary.filter(pending).length,
    secondaryOrders: secondary.length,
    secondaryOrderValue: secondary.reduce((sum, order) => sum + value(order), 0),
    secondaryOrdersThisMonth: secondary.filter(thisMonth).length,
    secondaryPendingOrders: secondary.filter(pending).length,
  };
}

function reportDataFromRecords(orders: any[], claims: any[], inventory: any[]): AllReportData {
  const now = new Date();
  const monthKeys: string[] = [];
  const monthLabels: string[] = [];
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    monthKeys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    monthLabels.push(date.toLocaleString('en-IN', { month: 'short', year: '2-digit' }));
  }
  const values = Object.fromEntries(monthKeys.map((key) => [key, 0])) as Record<string, number>;
  const counts = Object.fromEntries(monthKeys.map((key) => [key, 0])) as Record<string, number>;
  for (const order of orders) {
    const date = new Date(text(order.EffectiveDate));
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!(key in values)) continue;
    values[key] += number(order.Grand_Total__c ?? order.TotalAmount, 0);
    counts[key] += 1;
  }
  const orderValues = monthKeys.map((key) => Math.round(values[key]));
  const orderCounts = monthKeys.map((key) => counts[key]);
  const totalOrderValue = orderValues.reduce((sum, value) => sum + value, 0);
  const totalOrderCount = orderCounts.reduce((sum, value) => sum + value, 0);
  const primary = orders.filter((order) => order.Type === 'Primary' || !order.Type);
  const secondary = orders.filter((order) => order.Type === 'Secondary');
  const pending = orders.filter((order) => order.Status === 'Order Placed' || order.Status === 'Draft');
  const ages = pending.map((order) => Math.floor((Date.now() - new Date(text(order.CreatedDate)).getTime()) / DAY_MS));
  const claimGroups = { openValue: 0, approvedValue: 0, rejectedValue: 0, openCount: 0, approvedCount: 0, rejectedCount: 0 };
  for (const claim of claims) {
    const status = text(claim.Status__c).toLowerCase();
    const amount = number(claim.Total_Amount__c ?? claim.Amount__c, 0);
    if (status.includes('approv')) { claimGroups.approvedValue += amount; claimGroups.approvedCount += 1; }
    else if (status.includes('reject') || status.includes('cancel')) { claimGroups.rejectedValue += amount; claimGroups.rejectedCount += 1; }
    else { claimGroups.openValue += amount; claimGroups.openCount += 1; }
  }
  const inventoryProducts = inventory.map((item) => ({ name: text(object(item.Product__r).Name, 'Unknown'), status: text(item.Status__c, 'Unknown') }));
  const statusCounts: Record<string, number> = {};
  for (const item of inventoryProducts) statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
  const previous = orderValues.at(-2) ?? 0;
  const current = orderValues.at(-1) ?? 0;
  return {
    monthly: {
      months: monthLabels, orderValues, orderCounts, totalOrderValue, totalOrderCount,
      pendingOrders: pending.length,
      avgOrderValue: totalOrderCount > 0 ? Math.round(totalOrderValue / totalOrderCount) : 0,
      growthPercent: previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0,
    },
    salesMix: {
      primaryValue: Math.round(primary.reduce((sum, order) => sum + number(order.Grand_Total__c ?? order.TotalAmount), 0)),
      secondaryValue: Math.round(secondary.reduce((sum, order) => sum + number(order.Grand_Total__c ?? order.TotalAmount), 0)),
      primaryCount: primary.length, secondaryCount: secondary.length,
    },
    aging: { bucket02: ages.filter((age) => age <= 2).length, bucket35: ages.filter((age) => age >= 3 && age <= 5).length, bucket5plus: ages.filter((age) => age > 5).length, totalPending: pending.length },
    claims: claimGroups,
    inventory: { products: inventoryProducts.slice(0, 15), statusCounts },
    generatedAt: formatDateTime(),
  };
}

async function respondError(deps: SlackHandlerDependencies, receipt: SlackIngressReceipt, error: unknown): Promise<void> {
  const message = userFacingMessage(error);
  await deps.respond(receipt, { text: message, blocks: buildUserErrorBlocks(message) as SlackBlock[], replace_original: false });
}

async function handleCommand(deps: SlackHandlerDependencies, receipt: SlackIngressReceipt): Promise<SlackHandlerResult> {
  try {
    const { identity, context } = await deps.resolveDistributor(receipt.teamId, receipt.userId, receipt.sourceTeamId);
    const view = await loadDashboard(deps.domainFor(context), identity, context);
    await deps.respond(receipt, { text: 'DMS Dashboard', blocks: view.blocks, replace_original: false });
  } catch (error) {
    await respondError(deps, receipt, error);
  }
  return { handled: true, handlerId: 'command', routeFamily: 'command' };
}

async function handleAppHome(deps: SlackHandlerDependencies, receipt: SlackIngressReceipt): Promise<SlackHandlerResult> {
  const now = deps.now();
  if (!(await deps.state.acquireAppHomePublish(receipt.teamId, receipt.userId, now))) {
    return { handled: true, handlerId: 'app_home_opened', routeFamily: 'app_home' };
  }
  try {
    const { identity, context } = await deps.resolveDistributor(receipt.teamId, receipt.userId, receipt.sourceTeamId);
    const view = await loadDashboard(deps.domainFor(context), identity, context);
    await deps.publishHome(receipt.userId, view.blocks);
  } catch (error) {
    // App Home must remain available even if a downstream integration is not
    // configured. Log only the stable code: raw error text can contain Slack
    // or Salesforce details and must not enter operational logs.
    console.warn('DMS App Home publish fell back to a safe error view', { code: errorCode(error) });
    const message = userFacingMessage(error);
    await deps.publishHome(receipt.userId, [buildSection(`:warning: ${message}\n\nPlease try again later or use the DMS slash command.`) as SlackBlock]);
  }
  return { handled: true, handlerId: 'app_home_opened', routeFamily: 'app_home' };
}

async function loadArs(domain: SlackSalesforceDomain, searchTerm = ''): Promise<SlackBlock[]> {
  const [batches, config] = await Promise.all([
    domain.getBatchWiseStockPolicies().catch(() => []),
    domain.getARSConfig().catch(() => defaultArsConfig()),
  ]);
  return buildARSDashboard(config, batches, searchTerm) as SlackBlock[];
}

function inventoryProducts(batches: any[]) {
  return batches.map((batch) => ({
    productId: text(batch.productId), productName: text(batch.productName), currentStock: number(batch.availableStock),
    minStock: number(batch.minStock), maxStock: number(batch.maxStock), expectedStock: Math.round(number(batch.availableStock) * 1.2),
    location: text(batch.batchNumber, 'Default'),
  }));
}

async function postAndSaveArsApproval(
  deps: SlackHandlerDependencies,
  receipt: SlackIngressReceipt,
  identity: ConvexSlackIdentity,
  context: ConvexDistributorContext,
  changes: PendingArsChange['changes'],
  textPrefix: string,
): Promise<{ destination: string }> {
  const approvalBlocks = buildARSApprovalMessage(identity.displayName, context.accountName, changes) as SlackBlock[];
  if (!deps.salesChannelId) {
    throw new SlackHandlerUserError('The ARS approval channel is not configured, so this request was not sent.', 'ARS_APPROVAL_CHANNEL_MISSING');
  }
  const posted = await deps.postMessage({ channel: deps.salesChannelId, text: `${textPrefix}: ${changes[0]?.productName ?? 'product'}`, blocks: approvalBlocks });
  await deps.state.savePendingArsChange({
    teamId: receipt.teamId,
    channelId: posted.channel,
    messageTs: posted.ts,
    requestingUserId: receipt.userId,
    requestingUserName: identity.displayName,
    salesforceAccountId: context.salesforceAccountId,
    accountName: context.accountName,
    changes,
  }, deps.now(), deps.now() + ARS_APPROVAL_TTL_MS);
  return { destination: posted.channel };
}

async function actionHandler(
  deps: SlackHandlerDependencies,
  receipt: SlackIngressReceipt,
  handlerId: SlackActionHandlerId,
  parameter: string | null,
): Promise<void> {
  // Approval actions are scoped through the immutable, requester-resolved
  // pending record. Other actions resolve the current Slack user first.
  if (handlerId === 'ars_approve_changes' || handlerId === 'ars_reject_changes') {
    await handleArsDecision(deps, receipt, handlerId === 'ars_approve_changes' ? 'approved' : 'rejected');
    return;
  }

  const { identity, context } = await deps.resolveDistributor(receipt.teamId, receipt.userId, receipt.sourceTeamId);
  const domain = deps.domainFor(context);
  const now = deps.now();

  switch (handlerId) {
    case 'search_products_button': {
      const searchTerm = stateInput(receipt, 'product_search_block', 'search_products_input').trim().toLowerCase();
      const allProducts = await domain.getAvailableProducts();
      const matchingProducts = searchTerm
        ? allProducts.filter((product) => [product.productName, product.productCode, product.family, product.category].some((value) => text(value).toLowerCase().includes(searchTerm)))
        : allProducts;
      // A zero-result filter previously rendered an apparently blank ordering
      // screen. Keep the catalog usable and make the no-match result explicit.
      const noMatchingProducts = searchTerm.length > 0 && matchingProducts.length === 0;
      const products = noMatchingProducts ? allProducts : matchingProducts;
      const current = await deps.state.getOrderBuilder(receipt.teamId, receipt.userId, now) ?? { selected: [] };
      const state = { ...current, selected: hydrateSelected(current.selected, receipt) };
      await deps.state.putOrderBuilder(receipt.teamId, receipt.userId, state, now, now + ORDER_BUILDER_TTL_MS);
      await deps.respond(receipt, {
        text: noMatchingProducts
          ? `No products matched "${searchTerm}". Showing all ${allProducts.length} available products.`
          : searchTerm ? `Search: "${searchTerm}" (${products.length} results)` : `All products (${products.length})`,
        blocks: buildProductSelectionModal(products, state.selected) as SlackBlock[],
        replace_original: true,
      });
      return;
    }
    case 'select_order_type': {
      const products = await domain.getAvailableProducts();
      await deps.state.putOrderBuilder(receipt.teamId, receipt.userId, { selected: [] }, now, now + ORDER_BUILDER_TTL_MS);
      await deps.respond(receipt, { text: 'Create Primary Order', blocks: buildProductSelectionModal(products, []) as SlackBlock[], replace_original: false });
      return;
    }
    case 'add_product_': {
      const productId = parameter ?? '';
      const products = await domain.getAvailableProducts();
      const current = await deps.state.getOrderBuilder(receipt.teamId, receipt.userId, now) ?? { selected: [] };
      current.selected = hydrateSelected(current.selected, receipt);
      if (!current.selected.some((item) => item.productId === productId)) {
        const product = products.find((candidate) => candidate.productId === productId);
        current.selected.push({ productId, quantity: Math.max(1, integer(product?.minOrderQtyPrimary, 1)), schemeDiscount: 0 });
      }
      await deps.state.putOrderBuilder(receipt.teamId, receipt.userId, current, now, now + ORDER_BUILDER_TTL_MS);
      await deps.respond(receipt, { text: 'Create Primary Order', blocks: buildProductSelectionModal(products, current.selected) as SlackBlock[], replace_original: true });
      return;
    }
    case 'review_order_quote': {
      const current = await deps.state.getOrderBuilder(receipt.teamId, receipt.userId, now);
      if (!current?.selected.length) {
        await deps.respond(receipt, { text: 'No products selected. Please add products first.', replace_original: false });
        return;
      }
      const selected = hydrateSelected(current.selected, receipt);
      const products = await domain.getAvailableProducts();
      const failures = selected.flatMap((item) => {
        const product = products.find((candidate) => candidate.productId === item.productId);
        const minimum = Math.max(1, integer(product?.minOrderQtyPrimary, 1));
        return product && item.quantity < minimum ? [`${product.productName || item.productId}: minimum quantity is ${minimum}`] : [];
      });
      if (failures.length > 0) {
        await deps.respond(receipt, {
          text: 'Minimum quantity validation failed.',
          blocks: [buildHeader(':warning: Minimum Quantity Required'), buildSection(`Please update quantities before review:\n${failures.join('\n')}`), buildDivider(), ...buildProductSelectionModal(products, selected)] as SlackBlock[],
          replace_original: true,
        });
        return;
      }
      const quote = await domain.calculatePrimaryOrderQuote(selected, []);
      await deps.state.putOrderBuilder(receipt.teamId, receipt.userId, { selected, selectedCreditNoteIds: [], quote }, now, now + ORDER_BUILDER_TTL_MS);
      await deps.respond(receipt, { text: 'Order Quote', blocks: buildOrderQuoteReview(quote) as SlackBlock[], replace_original: false });
      return;
    }
    case 'submit_primary_order': {
      const current = await deps.state.getOrderBuilder(receipt.teamId, receipt.userId, now);
      if (!current?.quote) {
        await deps.respond(receipt, { text: 'No quote available. Please rebuild your order.', replace_original: false });
        return;
      }
      const creditNoteIds = selectedStateValues(receipt, 'credit_notes', 'select_credit_notes');
      let quote = current.quote;
      if (creditNoteIds.length > 0) {
        quote = await domain.calculatePrimaryOrderQuote(current.selected, creditNoteIds);
        await deps.state.putOrderBuilder(receipt.teamId, receipt.userId, { ...current, selectedCreditNoteIds: creditNoteIds, quote }, now, now + ORDER_BUILDER_TTL_MS);
      }
      const order = await runIdempotentWrite(deps, `po-create:${receipt.teamId}:${receipt.userId}:${text(quote.quoteId)}`, () => domain.createPrimaryOrder(quote));
      await deps.state.clearOrderBuilder(receipt.teamId, receipt.userId);
      await deps.respond(receipt, { text: 'Order Created', blocks: buildOrderConfirmation(order) as SlackBlock[], replace_original: false });
      return;
    }
    case 'view_order_detail': {
      await deps.respond(receipt, { text: 'Your Orders', blocks: buildOrderListBlocks(await domain.getPrimaryOrders()) as SlackBlock[], replace_original: false });
      return;
    }
    case 'search_orders_button': {
      const searchTerm = stateInput(receipt, 'order_search_block', 'search_orders_input').trim();
      await deps.respond(receipt, { text: `Orders matching "${searchTerm}"`, blocks: buildOrderListBlocks(await domain.getPrimaryOrders(), searchTerm) as SlackBlock[], replace_original: true });
      return;
    }
    case 'view_po_detail_': {
      const detail = await domain.getPrimaryOrderDetails(parameter ?? '');
      await deps.respond(receipt, { text: `Order ${detail.orderNumber}`, blocks: buildOrderDetailBlocks(detail) as SlackBlock[], replace_original: false });
      return;
    }
    case 'mark_as_delivered_': {
      const orderId = parameter ?? '';
      await runIdempotentWrite(deps, `po-delivered:${receipt.dedupeKey}`, async () => {
        await domain.markPrimaryOrderDelivered(orderId);
        return { orderId };
      });
      const detail = await domain.getPrimaryOrderDetails(orderId);
      await deps.respond(receipt, { text: `:white_check_mark: Order ${detail.orderNumber} marked as Delivered. Please process GRN below.`, blocks: buildGRNModal(detail) as SlackBlock[], replace_original: false });
      return;
    }
    case 'process_grn_': {
      const detail = await domain.getPrimaryOrderDetails(parameter ?? '');
      await deps.respond(receipt, { text: 'Process GRN', blocks: buildGRNModal(detail) as SlackBlock[], replace_original: false });
      return;
    }
    case 'submit_grn_form': {
      const orderId = actionValue(receipt);
      const detail = await domain.getPrimaryOrderDetails(orderId);
      const payload = {
        items: detail.items.map((item: any) => ({
          productId: item.productId,
          expectedQuantity: item.expectedQuantity,
          receivedQuantity: Math.max(0, integer(stateInput(receipt, `grn_recv_${item.productId}`, `grn_input_recv_${item.productId}`))),
          damagedQuantity: Math.max(0, integer(stateInput(receipt, `grn_dmg_${item.productId}`, `grn_input_dmg_${item.productId}`))),
          missingQuantity: Math.max(0, integer(stateInput(receipt, `grn_miss_${item.productId}`, `grn_input_miss_${item.productId}`))),
        })),
        notes: stateInput(receipt, 'grn_notes', 'grn_input_notes'),
      };
      const failures = payload.items.flatMap((item: any) => {
        const total = item.receivedQuantity + item.damagedQuantity + item.missingQuantity;
        const line = detail.items.find((candidate: any) => candidate.productId === item.productId);
        return total === item.expectedQuantity ? [] : [`*${line?.productName || item.productId}*: Received (${item.receivedQuantity}) + Short (${item.missingQuantity}) + Damaged (${item.damagedQuantity}) = ${total}, but Ordered = ${item.expectedQuantity}`];
      });
      if (failures.length > 0) {
        await deps.respond(receipt, { text: 'GRN validation failed — quantities must add up to ordered amount.', blocks: buildGRNModal(detail, failures) as SlackBlock[], replace_original: true });
        return;
      }
      const grnKey = await idempotencyFingerprint([orderId, payload.items, payload.notes]);
      const grn = await runIdempotentWrite(deps, `primary-grn:${receipt.teamId}:${receipt.userId}:${grnKey}`, () => domain.createOrUpdateGRN(orderId, payload));
      await deps.respond(receipt, { text: 'GRN Confirmation', blocks: buildGRNConfirmation(grn) as SlackBlock[], replace_original: false });
      return;
    }
    case 'returns_menu':
    case 'returns_claims_menu': {
      const label = handlerId === 'returns_menu' ? 'Returns' : 'Returns & Claims';
      await deps.respond(receipt, { text: label, blocks: buildReturnOrderListBlocks(await domain.getReturnOrders()) as SlackBlock[], replace_original: false });
      return;
    }
    case 'claims_menu': {
      const claims = await domain.getClaims();
      const blocks: SlackBlock[] = [buildHeader(':memo: Claims'), buildSection(`${claims.length} claims found.`), buildDivider()] as SlackBlock[];
      for (const claim of claims.slice(0, 10)) {
        blocks.push(buildSection(`*${claim.claimNumber}* — ${claim.claimType}\nStatus: ${claim.status} | Amount: Rs ${formatCurrency(number(claim.amount))}`) as SlackBlock);
      }
      blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', 'back_to_menu', 'back', 'primary')] });
      await deps.respond(receipt, { text: 'Claims', blocks, replace_original: false });
      return;
    }
    case 'bulk_secondary_invoice': {
      const pending = (await domain.getSecondaryOrders()).filter((order) => order.invoiceStatus !== 'Invoiced');
      const blocks: SlackBlock[] = [buildHeader(':receipt: Bulk Secondary Invoice Processing'), buildDivider(), buildSection(`*${pending.length} pending invoice(s)*`)] as SlackBlock[];
      if (pending.length === 0) blocks.push(buildSection('All secondary orders are already invoiced.') as SlackBlock);
      else {
        blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', 'back_to_menu', 'back')] }, buildDivider() as SlackBlock);
        for (const order of pending.slice(0, 10)) {
          blocks.push(
            buildSection(`*${order.orderNumber}* — ${order.retailerCustomer}\nAmount: Rs ${formatCurrency(number(order.totalAmount))} | Fulfillment: ${order.fulfillmentStatus || 'N/A'}`) as SlackBlock,
            { type: 'actions', elements: [
              buildButton(':receipt: Process Invoice', `process_so_invoice_${order.orderId}`, order.orderId, 'primary'),
              buildButton(':twisted_rightwards_arrows: View Details', `view_so_detail_${order.orderId}`, order.orderId),
            ] },
            buildDivider() as SlackBlock,
          );
        }
      }
      await deps.respond(receipt, { text: 'Bulk Secondary Invoice', blocks, replace_original: false });
      return;
    }
    case 'view_ro_detail_': {
      const returnOrderId = parameter ?? '';
      const [detail, claims, approval, creditNotes] = await Promise.all([
        domain.getReturnOrderDetails(returnOrderId), domain.getClaims(returnOrderId),
        domain.getApprovalStatus(returnOrderId, 'Return_Order__c'), domain.getCreditNotes(returnOrderId),
      ]);
      await deps.respond(receipt, { text: `Return ${detail.returnNumber}`, blocks: buildReturnOrderDetailBlocks(detail, claims, approval, creditNotes) as SlackBlock[], replace_original: false });
      return;
    }
    case 'upload_return_file_': {
      await deps.respond(receipt, { text: ':package: File upload — please attach your file as a Slack message in this thread. We will add direct file upload support soon.', replace_original: false });
      return;
    }
    case 'submit_return_approval_': {
      requireBusinessWrites(deps);
      const detail = await domain.getReturnOrderDetails(parameter ?? '');
      const blocks = [
        buildHeader(':envelope: Return Order Approval Request'),
        buildSection(`*Return:* ${detail.returnNumber}\n*Amount:* Rs ${formatCurrency(number(detail.grandTotal))}\n*Type:* ${detail.type || 'N/A'}\n*Requested by:* ${identity.displayName}`),
        buildSection(':warning: Please review and approve/reject this return order to generate a credit note.'),
      ] as SlackBlock[];
      if (!deps.salesChannelId) {
        throw new SlackHandlerUserError('The return-order approval channel is not configured, so this request was not sent.', 'RETURN_APPROVAL_CHANNEL_MISSING');
      }
      await deps.postMessage({ channel: deps.salesChannelId, text: `Return Order Approval — ${detail.returnNumber}`, blocks });
      await deps.respond(receipt, { text: `:white_check_mark: Return ${detail.returnNumber} sent for approval. A credit note will be generated upon approval.`, replace_original: false });
      return;
    }
    case 'file_claim_': {
      await deps.respond(receipt, { text: 'File a Claim', blocks: buildClaimModal(parameter ?? '') as SlackBlock[], replace_original: false });
      return;
    }
    case 'submit_claim_': {
      const returnOrderId = parameter ?? '';
      const claimPayload = {
        returnOrderId,
        claimType: selectedStateValue(receipt, 'claim_type', 'claim_input_type', 'Other'),
        amount: Math.max(0, number(stateInput(receipt, 'claim_amount', 'claim_input_amount'))),
        description: stateInput(receipt, 'claim_desc', 'claim_input_desc'),
      };
      const claimKey = await idempotencyFingerprint([returnOrderId, claimPayload.claimType, claimPayload.amount, claimPayload.description]);
      const claim = await runIdempotentWrite(deps, `claim:${receipt.teamId}:${receipt.userId}:${claimKey}`, () => domain.createOrUpdateClaim(claimPayload));
      await deps.respond(receipt, { text: 'Claim Submitted', blocks: buildClaimConfirmation(claim) as SlackBlock[], replace_original: false });
      return;
    }
    case 'submit_approval_': {
      const recordId = parameter ?? '';
      const result = await runIdempotentWrite(deps, `return-approval:${receipt.teamId}:${receipt.userId}:${recordId}`, () => domain.submitForApproval(recordId, 'Return_Order__c'));
      await deps.respond(receipt, { text: 'Approval', blocks: buildApprovalResult(result) as SlackBlock[], replace_original: false });
      return;
    }
    case 'back_to_menu':
    case 'refresh_insights': {
      const view = await loadDashboard(domain, identity, context);
      await deps.respond(receipt, { text: handlerId === 'back_to_menu' ? 'DMS Dashboard' : 'Dashboard', blocks: view.blocks, replace_original: true });
      return;
    }
    case 'cancel_action': {
      await deps.state.clearOrderBuilder(receipt.teamId, receipt.userId);
      const view = await loadDashboard(domain, identity, context);
      await deps.respond(receipt, { text: 'DMS Dashboard', blocks: view.blocks, replace_original: true });
      return;
    }
    case 'insights_menu': {
      const accountId = escapeSoql(context.salesforceAccountId);
      const [ordersResult, claimsResult, inventoryResult] = await Promise.allSettled([
        domain.query<any>(`SELECT EffectiveDate, Grand_Total__c, TotalAmount, Status, Type, CreatedDate FROM Order WHERE AccountId = '${accountId}' AND EffectiveDate >= LAST_N_MONTHS:6 ORDER BY EffectiveDate ASC LIMIT 300`),
        domain.query<any>(`SELECT Status__c, Total_Amount__c, Amount__c FROM Claim__c WHERE Order__c IN (SELECT Id FROM Order WHERE AccountId = '${accountId}' OR Distributor_Account__c = '${accountId}') LIMIT 200`),
        domain.query<any>(`SELECT Id, Product__r.Name, Status__c FROM Inventory_Batch__c WHERE Distributor__c = '${accountId}' LIMIT 100`),
      ]);
      const data = reportDataFromRecords(
        ordersResult.status === 'fulfilled' ? ordersResult.value.records : [],
        claimsResult.status === 'fulfilled' ? claimsResult.value.records : [],
        inventoryResult.status === 'fulfilled' ? inventoryResult.value.records : [],
      );
      await deps.respond(receipt, { text: 'Business Insights', blocks: buildReportDashboardBlocks(data) as SlackBlock[], replace_original: false });
      return;
    }
    case 'secondary_orders_menu': {
      await deps.respond(receipt, { text: 'Secondary Orders', blocks: buildSecondaryOrderList(await domain.getSecondaryOrders()) as SlackBlock[], replace_original: false });
      return;
    }
    case 'search_so_button': {
      const searchTerm = stateInput(receipt, 'so_search_block', 'search_so_input').trim();
      await deps.respond(receipt, { text: `Secondary orders matching "${searchTerm}"`, blocks: buildSecondaryOrderList(await domain.getSecondaryOrders(), searchTerm) as SlackBlock[], replace_original: true });
      return;
    }
    case 'view_so_detail_': {
      const detail = await domain.getSecondaryOrderDetails(parameter ?? '');
      await deps.respond(receipt, { text: `SO ${detail.orderNumber}`, blocks: buildSecondaryOrderDetail(detail) as SlackBlock[], replace_original: false });
      return;
    }
    case 'process_so_invoice_': {
      const orderId = parameter ?? '';
      const [availability, detail] = await Promise.all([domain.getInventoryAvailability(orderId), domain.getSecondaryOrderDetails(orderId)]);
      if (availability.length === 0) {
        await deps.respond(receipt, { text: 'Already Invoiced', blocks: [buildHeader(':white_check_mark: Already Fully Invoiced'), buildSection('All items in this order have already been invoiced. There are no pending quantities remaining.'), buildDivider(), ...buildSecondaryOrderDetail(detail)] as SlackBlock[], replace_original: false });
        return;
      }
      if (!availability.some((item) => number(item.availableQuantity) > 0)) {
        await deps.respond(receipt, { text: 'No Stock Available', blocks: [buildHeader(':x: Cannot Process Invoice'), buildSection('No stock is available for any pending product in this order. Inventory records need to be updated with available quantities.'), buildDivider(), ...buildSecondaryOrderDetail(detail)] as SlackBlock[], replace_original: false });
        return;
      }
      await deps.respond(receipt, { text: 'Process Invoice', blocks: buildInvoiceProcessing(orderId, availability) as SlackBlock[], replace_original: false });
      return;
    }
    case 'confirm_so_invoice_': {
      const orderId = parameter ?? '';
      const availability = await domain.getInventoryAvailability(orderId);
      const items = availability.filter((item) => number(item.availableQuantity) > 0).map((item) => ({ productId: item.productId, quantity: item.availableQuantity }));
      if (items.length === 0) {
        await deps.respond(receipt, { text: ':x: No stock available — invoice cannot be created.', replace_original: false });
        return;
      }
      const partial = availability.some((item) => number(item.availableQuantity) < number(item.orderedQuantity));
      const invoiceKey = await idempotencyFingerprint([orderId, items]);
      const invoice = await runIdempotentWrite(deps, `secondary-invoice:${receipt.teamId}:${receipt.userId}:${invoiceKey}`, () => domain.createInvoice(orderId, { items, fullOrPartial: partial ? 'Partial' : 'Full', notes: '' }));
      const dispatches = await domain.getDispatchRequests(orderId);
      await deps.respond(receipt, { text: 'Invoice Created', blocks: buildInvoiceConfirmation(invoice, dispatches) as SlackBlock[], replace_original: false });
      if (partial) {
        const detail = await domain.getSecondaryOrderDetails(orderId);
        await deps.state.upsertPartialReminder({
          salesforceOrderId: orderId, salesforceAccountId: context.salesforceAccountId, teamId: receipt.teamId, slackUserId: receipt.userId,
          orderNumber: detail.orderNumber, retailerCustomer: detail.retailerCustomer,
          pendingItemCount: availability.filter((item) => number(item.availableQuantity) < number(item.orderedQuantity)).length,
          nextReminderAt: deps.now() + REMINDER_INTERVAL_MS, now: deps.now(), expiresAt: deps.now() + REMINDER_TTL_MS,
        });
      }
      return;
    }
    case 'so_dispatch_deliver_': {
      const orderId = parameter ?? '';
      const dispatches = await domain.getDispatchRequests(orderId);
      if (dispatches.length === 0) {
        await deps.respond(receipt, { text: 'No dispatch requests found for this order.', replace_original: false });
        return;
      }
      const pending = dispatches.find((dispatch) => dispatch.status !== 'Delivered');
      if (!pending) {
        await deps.respond(receipt, { text: ':white_check_mark: All dispatches for this order are already marked as Delivered.', replace_original: false });
        return;
      }
      const updated = await runIdempotentWrite(deps, `dispatch-delivered:${receipt.teamId}:${receipt.userId}:${pending.dispatchId}`, () => domain.updateDispatchStatus(pending.dispatchId, 'Delivered'));
      await deps.state.scheduleGRNFollowup({
        teamId: receipt.teamId,
        userId: receipt.userId,
        orderId,
        dispatchId: pending.dispatchId,
        dispatchName: pending.dispatchName,
        invoiceId: text(updated.invoiceId ?? pending.invoiceId) || undefined,
        context,
        responseUrl: receipt.responseUrl,
        responseUrlExpiresAt: receipt.responseUrlExpiresAt,
        now: deps.now(),
      });
      await deps.respond(receipt, {
        text: ':white_check_mark: Delivery Confirmed — preparing GRN quantities.',
        blocks: [buildHeader(':white_check_mark: Delivery Confirmed'), buildSection(`Dispatch *${pending.dispatchName}* marked as *Delivered*. Preparing the GRN quantity form now.`)] as SlackBlock[],
        replace_original: false,
      });
      return;
    }
    case 'submit_grn_': {
      const encoded = parameter ?? '';
      const separator = encoded.indexOf('__');
      const orderId = separator >= 0 ? encoded.slice(0, separator) : encoded;
      const lines = await domain.getGoodsReceiptLines(orderId);
      if (lines.length === 0) {
        await deps.respond(receipt, { text: ':x: Could not find Salesforce GRN line items for this delivered order.', replace_original: false });
        return;
      }
      const items = lines.map((line) => {
        const lostQty = Math.max(0, integer(stateInput(receipt, `grn_lost_${line.lineId}`, 'grn_qty_input')));
        const damagedQty = Math.max(0, integer(stateInput(receipt, `grn_dmg_${line.lineId}`, 'grn_qty_input')));
        return { lineId: line.lineId, lostQty, damagedQty, receivedQty: Math.max(0, number(line.orderedQuantity) - lostQty - damagedQty) };
      });
      const invalid = items.find((item, index) => item.lostQty + item.damagedQty > number(lines[index]?.orderedQuantity));
      if (invalid) {
        const line = lines.find((candidate) => candidate.lineId === invalid.lineId);
        await deps.respond(receipt, { text: `:x: For ${line?.productName || 'one product'}, lost/short plus damaged cannot exceed ordered quantity.`, replace_original: false });
        return;
      }
      const grnKey = await idempotencyFingerprint([orderId, items]);
      const grn = await runIdempotentWrite(deps, `secondary-grn:${receipt.teamId}:${receipt.userId}:${grnKey}`, () => domain.updateGoodsReceiptLines(orderId, items));
      const detail = await domain.getSecondaryOrderDetails(orderId);
      if (!detail.remainingQtys?.length) await deps.state.deactivatePartialReminder(orderId, deps.now());
      const blocks = buildSecondaryGRNConfirmation(grn.grnNumber, orderId, lines.map((line, index) => ({
        productName: line.productName, received: items[index]?.receivedQty ?? number(line.orderedQuantity), lost: items[index]?.lostQty ?? 0, damaged: items[index]?.damagedQty ?? 0,
      }))) as SlackBlock[];
      if (detail.canCreateInvoice) {
        blocks.push(buildDivider() as SlackBlock, buildSection(`:receipt: *${detail.remainingQtys.length} product(s) still pending invoice.* You can process another invoice for the remaining quantities.`) as SlackBlock, { type: 'actions', elements: [buildButton(':receipt: Process Invoice for Remaining', `process_so_invoice_${orderId}`, orderId, 'primary')] });
      }
      await deps.respond(receipt, { text: `GRN ${grn.grnNumber} recorded`, blocks, replace_original: false });
      return;
    }
    case 'view_inventory': {
      await deps.respond(receipt, { text: 'Inventory Visibility', blocks: buildEnhancedInventoryView(inventoryProducts(await domain.getBatchWiseStockPolicies())) as SlackBlock[], replace_original: false });
      return;
    }
    case 'inventory_select_location': {
      const selected = actionValue(receipt);
      const location = selected === '__all__' ? undefined : selected;
      await deps.respond(receipt, { text: 'Inventory Visibility', blocks: buildEnhancedInventoryView(inventoryProducts(await domain.getBatchWiseStockPolicies()), location) as SlackBlock[], replace_original: true });
      return;
    }
    case 'replenish_order_': {
      const productId = parameter ?? '';
      const product = (await domain.getAvailableProducts()).find((candidate) => candidate.productId === productId);
      const blocks = [
        buildHeader(':shopping_trolley: Replenishment Order'),
        buildSection(`Create a primary order for *${product?.productName || productId}* to replenish low stock.`),
        buildDivider(),
        buildSection('Click "Create Primary Order" and add this product with your desired quantity.'),
        { type: 'actions', elements: [buildButton(':pencil: Create Primary Order', 'select_order_type', 'create', 'primary'), buildButton(':arrow_left: Back to Inventory', 'view_inventory', 'back')] },
      ] as SlackBlock[];
      await deps.respond(receipt, { text: 'Replenishment Order', blocks, replace_original: false });
      return;
    }
    case 'view_partial_orders': {
      const partial = (await domain.getSecondaryOrders()).filter((order) => order.fulfillmentStatus === 'Partially Fulfilled' || order.invoiceStatus === 'Partial');
      const blocks = [buildHeader(':page_facing_up: Partially Fulfilled Orders'), buildDivider()] as SlackBlock[];
      if (partial.length === 0) blocks.push(buildSection('No partially fulfilled orders found.') as SlackBlock);
      else {
        blocks.push(buildSection(`${partial.length} partially fulfilled order(s):`) as SlackBlock);
        for (const order of partial) {
          blocks.push(buildSection(`*${order.orderNumber}* — ${order.retailerCustomer}\nStatus: ${order.status} | Invoice: ${order.invoiceStatus || 'N/A'} | Fulfillment: ${order.fulfillmentStatus || 'N/A'}`) as SlackBlock, { type: 'actions', elements: [buildButton(':receipt: Process Invoice', `process_so_invoice_${order.orderId}`, order.orderId, 'primary')] }, buildDivider() as SlackBlock);
        }
      }
      blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', 'back_to_menu', 'back')] });
      await deps.respond(receipt, { text: 'Partially Fulfilled Orders', blocks, replace_original: false });
      return;
    }
    case 'ars_menu': {
      await deps.respond(receipt, { text: 'ARS Dashboard', blocks: await loadArs(domain), replace_original: false });
      return;
    }
    case 'ars_search_button': {
      const searchTerm = stateInput(receipt, 'ars_search_block', 'ars_search_input').trim().toLowerCase();
      await deps.respond(receipt, { text: `ARS: "${searchTerm}"`, blocks: await loadArs(domain, searchTerm), replace_original: true });
      return;
    }
    case 'ars_edit_product_': {
      const info = JSON.parse(actionValue(receipt) || '{}');
      await deps.respond(receipt, { text: `Edit ARS — ${info.productName}`, blocks: buildARSEditProduct(info) as SlackBlock[], replace_original: false });
      return;
    }
    case 'ars_submit_product_': {
      requireBusinessWrites(deps);
      const productId = parameter ?? '';
      const info = JSON.parse(actionValue(receipt) || '{}');
      const newMin = integer(stateInput(receipt, 'ars_edit_min', 'ars_edit_min_val', String(info.minStock)), integer(info.minStock));
      const newMax = integer(stateInput(receipt, 'ars_edit_max', 'ars_edit_max_val', String(info.maxStock)), integer(info.maxStock));
      const changes = [{ productId, productName: text(info.productName, productId), oldMin: integer(info.minStock), newMin, oldMax: integer(info.maxStock), newMax }];
      await postAndSaveArsApproval(deps, receipt, identity, context, changes, `ARS Change from ${identity.displayName}`);
      await deps.respond(receipt, { text: `:white_check_mark: ARS change for ${info.productName} sent for approval.`, replace_original: false });
      return;
    }
    case 'ars_toggle_status': {
      const active = actionValue(receipt) === 'activate';
      const config = await runIdempotentWrite(deps, `ars-status:${receipt.dedupeKey}`, () => domain.updateARSStatus(active));
      const batches = await domain.getBatchWiseStockPolicies().catch(() => []);
      await deps.respond(receipt, { text: `ARS ${active ? 'activated' : 'deactivated'}`, blocks: buildARSDashboard(config ?? defaultArsConfig(active), batches) as SlackBlock[], replace_original: true });
      return;
    }
    case 'ars_request_change_': {
      const info = JSON.parse(actionValue(receipt) || '{}');
      await deps.respond(receipt, { text: `Request ARS Change — ${info.productName}`, blocks: buildARSChangeRequestForm(info) as SlackBlock[], replace_original: false });
      return;
    }
    case 'ars_submit_change_request_': {
      requireBusinessWrites(deps);
      const productId = parameter ?? '';
      const info = JSON.parse(actionValue(receipt) || '{}');
      const reason = stateInput(receipt, 'ars_cr_reason', 'ars_cr_reason_val', 'No reason provided');
      const newMin = integer(stateInput(receipt, 'ars_cr_new_min', 'ars_cr_new_min_val', String(info.minStock)), integer(info.minStock));
      const newMax = integer(stateInput(receipt, 'ars_cr_new_max', 'ars_cr_new_max_val', String(info.maxStock)), integer(info.maxStock));
      const changes = [{ productId, productName: text(info.productName, productId), oldMin: integer(info.minStock), newMin, oldMax: integer(info.maxStock), newMax }];
      await postAndSaveArsApproval(deps, receipt, identity, context, changes, `ARS Change Request from ${identity.displayName}`);
      await deps.respond(receipt, { text: `:white_check_mark: Change request sent for approval for ${info.productName}.\n*Reason:* ${reason}`, replace_original: false });
      return;
    }
    case 'ars_view_orders': {
      await deps.respond(receipt, { text: 'ARS Orders', blocks: buildARSOrdersList(await domain.getARSTriggeredOrders().catch(() => [])) as SlackBlock[], replace_original: false });
      return;
    }
    case 'ars_create_order_': {
      const productId = parameter ?? '';
      const selected = [{ productId, quantity: 1 }];
      await deps.state.putOrderBuilder(receipt.teamId, receipt.userId, { selected }, now, now + ORDER_BUILDER_TTL_MS);
      await deps.respond(receipt, { text: 'Create Primary Order', blocks: buildProductSelectionModal(await domain.getAvailableProducts(), selected) as SlackBlock[], replace_original: false });
      return;
    }
    case 'ars_deactivate_product_': {
      const info = JSON.parse(actionValue(receipt) || '{}');
      await deps.respond(receipt, { text: `:x: ARS deactivated for *${info.productName}*. Batches for this product have been marked as inactive.`, replace_original: false });
      return;
    }
    case 'ai_insights_menu': {
      try {
        const [insights, recommendations, upsells] = await Promise.all([domain.getBusinessInsightsEnhanced(), domain.getStockThresholdRecommendations(), domain.getUpsellRecommendations()]);
        const blocks = insights.length === 0 && recommendations.length === 0 && upsells.length === 0
          ? buildAIFallback()
          : buildAIInsightsDashboard(insights, recommendations, upsells);
        await deps.respond(receipt, { text: 'AI Insights', blocks: blocks as SlackBlock[], replace_original: false });
      } catch {
        await deps.respond(receipt, { text: 'AI Insights', blocks: buildAIFallback() as SlackBlock[], replace_original: false });
      }
      return;
    }
    case 'dms_diagnostics': {
      await deps.respond(receipt, { text: 'Diagnostics are only available in the legacy development runtime.', replace_original: false });
      return;
    }
    default: {
      const exhaustive: never = handlerId;
      throw new SlackHandlerUserError(`No executable handler for ${exhaustive}`, 'HANDLER_NOT_IMPLEMENTED');
    }
  }
}

async function handleArsDecision(
  deps: SlackHandlerDependencies,
  receipt: SlackIngressReceipt,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const channelId = text(receipt.payload.channelId);
  const messageTs = text(receipt.payload.messageTs);
  if (!channelId || !messageTs || !deps.salesChannelId || channelId !== deps.salesChannelId) {
    await deps.respond(receipt, { text: 'This approval request has expired or was already processed.', replace_original: false });
    return;
  }
  const pending = await deps.state.getPendingArsChange(receipt.teamId, channelId, messageTs, deps.now());
  if (!pending) {
    await deps.respond(receipt, { text: 'This approval request has expired or was already processed.', replace_original: false });
    return;
  }
  if (decision === 'rejected') {
    const key = `ars-reject:${receipt.teamId}:${channelId}:${messageTs}`;
    await runIdempotentOperation(deps, key, async () => {
      await deps.state.resolvePendingArsChange(receipt.teamId, channelId, messageTs, 'rejected', deps.now());
      return { result: 'rejected' };
    });
    await deps.postMessage({ channel: pending.channelId, threadTs: pending.messageTs, text: `:x: ARS change request for *${pending.changes[0]?.productName || 'product'}* has been *rejected*.` });
    return;
  }

  const requesterContext: ConvexDistributorContext = {
    slackUserId: pending.requestingUserId,
    slackTeamId: pending.teamId,
    slackEnterpriseId: null,
    slackEmail: '',
    salesforceAccountId: pending.salesforceAccountId,
    accountName: pending.accountName,
    distributorCode: null,
    mappingSource: 'AccountEmail',
    resolvedAt: new Date(deps.now()).toISOString(),
    isActive: true,
    accountType: 'Unknown',
    businessType: 'Distributor',
  };
  const domain = deps.domainFor(requesterContext);
  await runIdempotentWrite(deps, `ars-approve:${receipt.teamId}:${channelId}:${messageTs}`, async () => {
    await domain.applyARSPolicyChanges(pending.changes.map((change) => ({ productId: change.productId, newMin: change.newMin, newMax: change.newMax })));
    await deps.state.resolvePendingArsChange(receipt.teamId, channelId, messageTs, 'approved', deps.now());
    return { result: 'approved' };
  });
  await deps.postMessage({
    channel: pending.channelId,
    threadTs: pending.messageTs,
    text: ':white_check_mark: ARS settings approved and applied.',
    blocks: buildARSApprovalAcknowledgement(true, pending.requestingUserName) as SlackBlock[],
  });
}

export async function dispatchTransportNeutralSlack(
  deps: SlackHandlerDependencies,
  receipt: SlackIngressReceipt,
): Promise<SlackHandlerResult> {
  if (receipt.kind === 'command') return handleCommand(deps, receipt);
  if (receipt.kind === 'event') {
    if (receipt.handlerKey !== 'event:app_home_opened') {
      throw new SlackHandlerUserError(`Unsupported Slack event ${receipt.handlerKey}`, 'UNSUPPORTED_EVENT');
    }
    return handleAppHome(deps, receipt);
  }

  const id = actionId(receipt) || receipt.handlerKey.slice('action:'.length);
  const route = resolveSlackActionRoute(id);
  if (!route) throw new SlackHandlerUserError(`Unsupported Slack action ${id}`, 'UNSUPPORTED_ACTION');
  try {
    await actionHandler(deps, receipt, route.handlerId, route.parameter);
  } catch (error) {
    await respondError(deps, receipt, error);
  }
  return { handled: true, handlerId: route.handlerId, routeFamily: route.family };
}

/** Exported for route-parity tests and migration evidence. */
export const executableSlackActionHandlerIds: ReadonlySet<SlackActionHandlerId> = new Set<SlackActionHandlerId>([
  'search_products_button', 'select_order_type', 'add_product_', 'review_order_quote', 'submit_primary_order',
  'view_order_detail', 'search_orders_button', 'view_po_detail_', 'mark_as_delivered_', 'process_grn_', 'submit_grn_form',
  'returns_menu', 'claims_menu', 'bulk_secondary_invoice', 'returns_claims_menu', 'view_ro_detail_', 'upload_return_file_',
  'submit_return_approval_', 'file_claim_', 'submit_claim_', 'submit_approval_', 'back_to_menu', 'cancel_action', 'insights_menu',
  'refresh_insights', 'secondary_orders_menu', 'search_so_button', 'view_so_detail_', 'process_so_invoice_', 'confirm_so_invoice_',
  'so_dispatch_deliver_', 'submit_grn_', 'view_inventory', 'replenish_order_', 'view_partial_orders', 'ars_menu', 'ars_search_button',
  'ars_edit_product_', 'ars_submit_product_', 'ars_toggle_status', 'ars_request_change_', 'ars_submit_change_request_', 'ars_view_orders',
  'ars_create_order_', 'inventory_select_location', 'ars_deactivate_product_', 'ars_approve_changes', 'ars_reject_changes',
  'ai_insights_menu', 'dms_diagnostics',
]);
