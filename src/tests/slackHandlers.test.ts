import { describe, expect, it, vi } from 'vitest';
import {
  dispatchTransportNeutralSlack,
  executableSlackActionHandlerIds,
  type OrderBuilderState,
  type PendingArsChange,
  type SlackHandlerDependencies,
  type SlackIngressReceipt,
  type SlackSalesforceDomain,
} from '../../convex/slackHandlers';
import { exactActionFamilies, prefixActionFamilies } from '../../convex/slackRouteCatalog';

function receipt(overrides: Partial<SlackIngressReceipt> = {}): SlackIngressReceipt {
  return {
    dedupeKey: 'action:test',
    kind: 'action',
    teamId: 'T1',
    userId: 'U1',
    handlerKey: 'action:select_order_type',
    payload: { actionId: 'select_order_type', stateValues: {} },
    responseUrl: 'https://hooks.slack.com/actions/test',
    responseUrlExpiresAt: 99_999,
    ...overrides,
  };
}

function domain(overrides: Partial<SlackSalesforceDomain> = {}): SlackSalesforceDomain {
  const base: SlackSalesforceDomain = {
    query: vi.fn(async () => ({ records: [] })),
    getAvailableProducts: vi.fn(async () => []),
    calculatePrimaryOrderQuote: vi.fn(async () => ({ quoteId: 'Q1', lineItems: [], totalAmount: 0, schemeDiscount: 0, discountAmount: 0, creditApplied: 0, taxAmount: 0, grandTotal: 0, creditNotes: [] })),
    createPrimaryOrder: vi.fn(async () => ({ orderId: 'O1' })),
    getPrimaryOrders: vi.fn(async () => []),
    getPrimaryOrderDetails: vi.fn(async () => ({ orderId: 'O1', orderNumber: '1', items: [] })),
    markPrimaryOrderDelivered: vi.fn(async () => undefined),
    createOrUpdateGRN: vi.fn(async () => ({ grnId: 'G1', grnNumber: 'GRN-1', status: 'Received', items: [], createdDate: '' })),
    getReturnOrders: vi.fn(async () => []),
    getReturnOrderDetails: vi.fn(async () => ({ returnNumber: 'R1', grandTotal: 0 })),
    getClaims: vi.fn(async () => []),
    createOrUpdateClaim: vi.fn(async () => ({ claimId: 'C1', claimNumber: 'C1', status: 'Draft', amount: 0 })),
    submitForApproval: vi.fn(async () => ({ success: true, status: 'Pending', message: 'Submitted' })),
    getApprovalStatus: vi.fn(async () => null),
    getCreditNotes: vi.fn(async () => []),
    getSecondaryOrders: vi.fn(async () => []),
    getSecondaryOrderDetails: vi.fn(async () => ({ orderNumber: 'SO1', remainingQtys: [], items: [] })),
    getInventoryAvailability: vi.fn(async () => []),
    createInvoice: vi.fn(async () => ({ invoiceId: 'I1' })),
    getDispatchRequests: vi.fn(async () => []),
    updateDispatchStatus: vi.fn(async () => ({ dispatchId: 'D1' })),
    getGoodsReceiptLines: vi.fn(async () => []),
    updateGoodsReceiptLines: vi.fn(async () => ({ grnId: 'G1', grnNumber: 'G1' })),
    getInvoiceLineItems: vi.fn(async () => []),
    getARSConfig: vi.fn(async () => ({ autoReplenishmentEnabled: false, activeProducts: [], minThreshold: 0, maxThreshold: 0, replenishmentFrequency: 'N/A', lastModifiedBy: 'N/A', lastModifiedDate: 'N/A' })),
    updateARSStatus: vi.fn(async (active) => ({ autoReplenishmentEnabled: active, activeProducts: [], minThreshold: 0, maxThreshold: 0, replenishmentFrequency: 'N/A', lastModifiedBy: 'N/A', lastModifiedDate: 'N/A' })),
    getBatchWiseStockPolicies: vi.fn(async () => []),
    getARSTriggeredOrders: vi.fn(async () => []),
    applyARSPolicyChanges: vi.fn(async () => undefined),
    getBusinessInsightsEnhanced: vi.fn(async () => []),
    getStockThresholdRecommendations: vi.fn(async () => []),
    getUpsellRecommendations: vi.fn(async () => []),
  };
  return { ...base, ...overrides };
}

function dependencies(sf = domain(), overrides: Partial<SlackHandlerDependencies> = {}) {
  const builders = new Map<string, OrderBuilderState>();
  const pending = new Map<string, PendingArsChange>();
  const responses: Array<{ receipt: SlackIngressReceipt; message: any }> = [];
  const deps: SlackHandlerDependencies = {
    now: () => 10_000,
    resolveDistributor: vi.fn(async (teamId, userId) => ({
      identity: { slackUserId: userId, slackTeamId: teamId, slackEnterpriseId: null, email: 'user@example.com', displayName: 'Distributor User' },
      context: { slackUserId: userId, slackTeamId: teamId, slackEnterpriseId: null, slackEmail: 'user@example.com', salesforceAccountId: '001A', accountName: 'Distributor A', distributorCode: null, mappingSource: 'AccountEmail', resolvedAt: '2026-01-01T00:00:00Z', isActive: true, accountType: 'Partner', businessType: 'Distributor' },
    })),
    domainFor: vi.fn(() => sf),
    state: {
      getOrderBuilder: vi.fn(async (teamId, userId) => builders.get(`${teamId}:${userId}`) ?? null),
      putOrderBuilder: vi.fn(async (teamId, userId, value) => { builders.set(`${teamId}:${userId}`, value); }),
      clearOrderBuilder: vi.fn(async (teamId, userId) => { builders.delete(`${teamId}:${userId}`); }),
      acquireIdempotency: vi.fn(async () => ({ acquired: true, status: 'processing' as const })),
      completeIdempotency: vi.fn(async () => undefined),
      failIdempotency: vi.fn(async () => undefined),
      acquireAppHomePublish: vi.fn(async () => true),
      savePendingArsChange: vi.fn(async (change) => { pending.set(`${change.channelId}:${change.messageTs}`, change); }),
      getPendingArsChange: vi.fn(async (_teamId, channelId, messageTs) => pending.get(`${channelId}:${messageTs}`) ?? null),
      resolvePendingArsChange: vi.fn(async () => undefined),
      upsertPartialReminder: vi.fn(async () => undefined),
      scheduleGRNFollowup: vi.fn(async () => undefined),
      deactivatePartialReminder: vi.fn(async () => undefined),
    },
    respond: vi.fn(async (source, message) => { responses.push({ receipt: source, message }); }),
    publishHome: vi.fn(async () => undefined),
    postMessage: vi.fn(async ({ channel }) => ({ channel, ts: '171.1' })),
    salesChannelId: 'C-SALES',
    allowBusinessWrites: false,
    ...overrides,
  };
  return { deps, builders, pending, responses };
}

describe('transport-neutral Convex Slack handlers', () => {
  it('has executable logic for all 50 Bolt action registrations', () => {
    const catalog = new Set([...Object.keys(exactActionFamilies), ...prefixActionFamilies.map((route) => route.prefix)]);
    expect(catalog.size).toBe(50);
    expect(executableSlackActionHandlerIds).toEqual(catalog);
  });

  it('executes the primary-order entry route without a Bolt App and persists its builder', async () => {
    const sf = domain({ getAvailableProducts: vi.fn(async () => [{ productId: 'P1', productName: 'Product 1', productCode: 'P1', family: '', category: '', unitOfMeasure: 'Each', unitPrice: 1, packSize: 1, isActive: true, minOrderQtyPrimary: 1, minOrderQtySecondary: 1 }]) });
    const { deps, builders, responses } = dependencies(sf);

    await expect(dispatchTransportNeutralSlack(deps, receipt())).resolves.toMatchObject({ handled: true, handlerId: 'select_order_type' });
    expect(builders.get('T1:U1')).toEqual({ selected: [] });
    expect(responses.at(-1)?.message.text).toBe('Create Primary Order');
  });

  it('keeps the catalog visible when a product search has no matches', async () => {
    const sf = domain({ getAvailableProducts: vi.fn(async () => [{ productId: 'P1', productName: 'Binding Wire', productCode: 'PM-BWIRE', family: 'Metals', category: '', unitOfMeasure: 'Each', unitPrice: 1, packSize: 1, isActive: true, minOrderQtyPrimary: 1, minOrderQtySecondary: 1 }]) });
    const { deps, responses } = dependencies(sf);
    const search = receipt({
      handlerKey: 'action:search_products_button',
      payload: { actionId: 'search_products_button', stateValues: { product_search_block: { search_products_input: { value: 'cheese' } } } },
    });

    await dispatchTransportNeutralSlack(deps, search);

    expect(responses.at(-1)?.message.text).toBe('No products matched "cheese". Showing all 1 available products.');
    expect(responses.at(-1)?.message.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.objectContaining({ text: expect.stringContaining('Binding Wire') }) }),
    ]));
  });

  it('fails a business write closed while leaving the executable route available', async () => {
    const createPrimaryOrder = vi.fn(async () => ({ orderId: 'O1' }));
    const sf = domain({ createPrimaryOrder });
    const { deps, builders, responses } = dependencies(sf);
    builders.set('T1:U1', { selected: [{ productId: 'P1', quantity: 1 }], quote: { quoteId: 'Q1' } });
    const submit = receipt({ handlerKey: 'action:submit_primary_order', payload: { actionId: 'submit_primary_order', stateValues: {} } });

    await dispatchTransportNeutralSlack(deps, submit);

    expect(createPrimaryOrder).not.toHaveBeenCalled();
    expect(responses.at(-1)?.message.text).toContain('write action is disabled');
  });

  it('publishes app home through the transport port with durable suppression', async () => {
    const { deps } = dependencies();
    const event = receipt({ kind: 'event', handlerKey: 'event:app_home_opened', payload: { eventType: 'app_home_opened' }, responseUrl: undefined });

    await dispatchTransportNeutralSlack(deps, event);

    expect(deps.state.acquireAppHomePublish).toHaveBeenCalledWith('T1', 'U1', 10_000);
    expect(deps.publishHome).toHaveBeenCalledOnce();
  });

  it('publishes actionable workspace guidance when Slack cannot find the Home user', async () => {
    const slackProfileUnavailable = Object.assign(new Error('not for display'), { code: 'user_not_found' });
    const { deps } = dependencies(domain(), {
      resolveDistributor: vi.fn(async () => { throw slackProfileUnavailable; }),
    });
    const event = receipt({ kind: 'event', handlerKey: 'event:app_home_opened', payload: { eventType: 'app_home_opened' }, responseUrl: undefined });

    await dispatchTransportNeutralSlack(deps, event);

    expect(deps.publishHome).toHaveBeenCalledWith('U1', expect.arrayContaining([
      expect.objectContaining({ text: expect.objectContaining({ text: expect.stringContaining('cannot access your Slack profile') }) }),
    ]));
  });

  it('applies an ARS approval only against the durable requester account scope', async () => {
    const apply = vi.fn(async () => undefined);
    const sf = domain({ applyARSPolicyChanges: apply });
    const { deps, pending } = dependencies(sf, { allowBusinessWrites: true });
    pending.set('C-SALES:171.1', {
      teamId: 'T1', channelId: 'C-SALES', messageTs: '171.1', requestingUserId: 'U-REQUESTER', requestingUserName: 'Requester',
      salesforceAccountId: '001-REQUESTER', accountName: 'Requester Account',
      changes: [{ productId: 'P1', productName: 'Product 1', oldMin: 1, newMin: 2, oldMax: 4, newMax: 5 }],
    });
    const approval = receipt({
      handlerKey: 'action:ars_approve_changes',
      payload: { actionId: 'ars_approve_changes', channelId: 'C-SALES', messageTs: '171.1', stateValues: {} },
    });

    await dispatchTransportNeutralSlack(deps, approval);

    expect(deps.resolveDistributor).not.toHaveBeenCalled();
    expect(deps.domainFor).toHaveBeenCalledWith(expect.objectContaining({ salesforceAccountId: '001-REQUESTER', slackUserId: 'U-REQUESTER' }));
    expect(apply).toHaveBeenCalledWith([{ productId: 'P1', newMin: 2, newMax: 5 }]);
    expect(deps.state.resolvePendingArsChange).toHaveBeenCalledWith('T1', 'C-SALES', '171.1', 'approved', 10_000);
  });

  it('registers a durable thirty-minute partial-order reminder after a partial invoice', async () => {
    const sf = domain({
      getInventoryAvailability: vi.fn(async () => [{ productId: 'P1', availableQuantity: 1, orderedQuantity: 2 }]),
      createInvoice: vi.fn(async () => ({ invoiceId: 'I1', invoiceNumber: 'INV-1' })),
      getSecondaryOrderDetails: vi.fn(async () => ({ orderId: 'SO1', orderNumber: 'SO-1', retailerCustomer: 'Retailer', remainingQtys: [{ productId: 'P1' }], items: [] })),
      getDispatchRequests: vi.fn(async () => []),
    });
    const { deps } = dependencies(sf, { allowBusinessWrites: true });
    const submit = receipt({
      handlerKey: 'action:confirm_so_invoice_SO1',
      payload: { actionId: 'confirm_so_invoice_SO1', stateValues: {} },
    });

    await dispatchTransportNeutralSlack(deps, submit);

    expect(deps.state.upsertPartialReminder).toHaveBeenCalledWith(expect.objectContaining({
      salesforceOrderId: 'SO1', pendingItemCount: 1, nextReminderAt: 10_000 + 30 * 60 * 1000,
    }));
  });

  it('replaces the delivery GRN wait loop with a durable scoped follow-up', async () => {
    const updateDispatchStatus = vi.fn(async () => ({ dispatchId: 'D1', invoiceId: 'INV-1' }));
    const getGoodsReceiptLines = vi.fn(async () => []);
    const sf = domain({
      getDispatchRequests: vi.fn(async () => [{ dispatchId: 'D1', dispatchName: 'Dispatch 1', status: 'In Transit', invoiceId: 'INV-1' }]),
      updateDispatchStatus,
      getGoodsReceiptLines,
    });
    const { deps, responses } = dependencies(sf, { allowBusinessWrites: true });
    const deliver = receipt({
      handlerKey: 'action:so_dispatch_deliver_SO1',
      payload: { actionId: 'so_dispatch_deliver_SO1', stateValues: {} },
    });

    await dispatchTransportNeutralSlack(deps, deliver);

    expect(updateDispatchStatus).toHaveBeenCalledWith('D1', 'Delivered');
    expect(deps.state.scheduleGRNFollowup).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'T1', userId: 'U1', orderId: 'SO1', dispatchId: 'D1', invoiceId: 'INV-1',
      context: expect.objectContaining({ salesforceAccountId: '001A' }),
    }));
    expect(getGoodsReceiptLines).not.toHaveBeenCalled();
    expect(responses.at(-1)?.message.text).toContain('preparing GRN quantities');
  });
});
