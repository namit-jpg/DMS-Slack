import { describe, it, expect } from 'vitest';
import { MockSalesforceClient } from '../salesforce/MockSalesforceClient';
import { ResolvedDistributorContext, InvoicePayload } from '../salesforce/types';

function makeContext(overrides: Partial<ResolvedDistributorContext> = {}): ResolvedDistributorContext {
  return {
    slackUserId: 'U001', slackTeamId: 'T001', slackEnterpriseId: null,
    slackEmail: 'distributor@demo.com', salesforceAccountId: '001MOCK000000001',
    accountName: 'Demo Distributors Ltd', distributorCode: null,
    mappingSource: 'AccountEmail', resolvedAt: new Date().toISOString(),
    isActive: true, accountType: 'Partner', businessType: 'Distributor',
    ...overrides,
  };
}

describe('Secondary Orders', () => {
  const client = new MockSalesforceClient();
  const ctx = makeContext();

  it('lists secondary orders for distributor', async () => {
    const orders = await client.getSecondaryOrders(ctx);
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0].distributorId).toBe('001MOCK000000001');
    expect(orders[0].retailerCustomer).toBeDefined();
  });

  it('returns empty for other distributor', async () => {
    const otherCtx = makeContext({ salesforceAccountId: '001MOCK000000002' });
    const orders = await client.getSecondaryOrders(otherCtx);
    expect(orders.length).toBe(0);
  });

  it('gets secondary order details with ownership check', async () => {
    const detail = await client.getSecondaryOrderDetails(ctx, 'soMOCK000000001');
    expect(detail.orderNumber).toBe('SO-2026-0001');
    expect(detail.canCreateInvoice).toBe(true);
    expect(detail.canUpdateDispatch).toBe(true);
    expect(detail.items.length).toBeGreaterThan(0);
  });

  it('blocks cross-account secondary order access', async () => {
    const otherCtx = makeContext({ salesforceAccountId: '001MOCK000000002' });
    await expect(client.getSecondaryOrderDetails(otherCtx, 'soMOCK000000001')).rejects.toThrow();
  });

  it('gets inventory availability', async () => {
    const availability = await client.getInventoryAvailability(ctx, 'soMOCK000000001');
    expect(availability.length).toBeGreaterThan(0);
    expect(availability[0].batchDetails.length).toBeGreaterThan(0);
  });

  it('creates invoice for secondary order', async () => {
    const payload: InvoicePayload = { items: [], fullOrPartial: 'full', notes: '' };
    const invoice = await client.createInvoice(ctx, 'soMOCK000000001', payload);
    expect(invoice.invoiceNumber).toContain('INV-');
    expect(invoice.status).toBe('Generated');
    expect(invoice.fullPartial).toBe('full');
  });

  it('creates partial invoice', async () => {
    const payload: InvoicePayload = { items: [], fullOrPartial: 'partial', notes: 'Stock shortfall' };
    const invoice = await client.createInvoice(ctx, 'soMOCK000000001', payload);
    expect(invoice.fullPartial).toBe('partial');
  });

  it('gets dispatch requests for order', async () => {
    const dispatches = await client.getDispatchRequests(ctx, 'soMOCK000000001');
    expect(dispatches.length).toBeGreaterThan(0);
  });

  it('updates dispatch status', async () => {
    const updated = await client.updateDispatchStatus(ctx, 'd04MOCK000000001', 'Delivered');
    expect(updated.status).toBe('Delivered');
  });

  it('gets secondary order GRN', async () => {
    const grn = await client.getSecondaryOrderGRN(ctx, 'soMOCK000000001');
    expect(grn.grnNumber).toContain('GRN-');
    expect(grn.items.length).toBeGreaterThan(0);
  });
});

describe('ARS', () => {
  const client = new MockSalesforceClient();
  const ctx = makeContext();

  it('gets ARS config', async () => {
    const config = await client.getARSConfig(ctx);
    expect(config.autoReplenishmentEnabled).toBe(true);
    expect(config.activeProducts.isActive).toBe(true);
    expect(config.replenishmentFrequency).toBe('weekly');
  });

  it('deactivates ARS', async () => {
    const config = await client.updateARSStatus(ctx, false);
    expect(config.autoReplenishmentEnabled).toBe(false);
  });

  it('reactivates ARS', async () => {
    const config = await client.updateARSStatus(ctx, true);
    expect(config.autoReplenishmentEnabled).toBe(true);
  });

  it('gets batch-wise stock policies', async () => {
    const batches = await client.getBatchWiseStockPolicies(ctx);
    expect(batches.length).toBeGreaterThanOrEqual(3);
    expect(batches.some((b) => b.replenishmentStatus === 'Below Min')).toBe(true);
    expect(batches[0].expiryDate).toBeDefined();
  });

  it('gets ARS triggered orders', async () => {
    const orders = await client.getARSTriggeredOrders(ctx);
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0].reason).toContain('minimum threshold');
  });
});

describe('AI Insights', () => {
  const client = new MockSalesforceClient();
  const ctx = makeContext();

  it('gets business insights enhanced', async () => {
    const insights = await client.getBusinessInsightsEnhanced(ctx);
    expect(insights.length).toBeGreaterThanOrEqual(4);
    expect(insights.some((i) => i.type === 'performance')).toBe(true);
    expect(insights.some((i) => i.type === 'warning')).toBe(true);
    expect(insights.some((i) => i.type === 'opportunity')).toBe(true);
    expect(insights.some((i) => i.type === 'recommendation')).toBe(true);
    expect(insights[0].generatedAt).toBeDefined();
  });

  it('gets stock threshold recommendations', async () => {
    const recs = await client.getStockThresholdRecommendations(ctx);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].suggestedMinThreshold).toBeGreaterThan(recs[0].currentMinThreshold);
    expect(recs[0].confidence).toBeGreaterThan(0);
    expect(recs[0].applied).toBe(false);
    expect(recs[0].recommendationId).toBe('rec001');
  });

  it('gets upsell recommendations', async () => {
    const upsells = await client.getUpsellRecommendations(ctx);
    expect(upsells.length).toBeGreaterThan(0);
    expect(upsells[0].opportunityScore).toBeGreaterThan(0);
    expect(upsells[0].estimatedRevenue).toBeGreaterThan(0);
  });

  it('applies stock threshold recommendation', async () => {
    const rec = await client.applyStockThresholdRecommendation(ctx, 'rec001');
    expect(rec.applied).toBe(true);
    expect(rec.recommendationId).toBe('rec001');
  });
});

describe('SecondaryOrderPoller Idempotency', () => {
  const client = new MockSalesforceClient();

  it('detects duplicate secondary order notifications', async () => {
    const { checkIdempotency, markCompleted } = await import('../persistence/idempotencyStore');
    const key = 'so-notify-soMOCK000000001';
    markCompleted(key, {});
    expect(checkIdempotency(key)).toBe('completed');
  });
});

describe('ARS Idempotency', () => {
  it('prevents duplicate ARS toggles', async () => {
    const { checkIdempotency, markProcessing } = await import('../persistence/idempotencyStore');
    const key = 'ars-toggle-U001-12345';
    markProcessing(key);
    expect(checkIdempotency(key)).toBe('processing');
  });
});

describe('AI Recommendation Idempotency', () => {
  it('prevents duplicate applies', async () => {
    const { checkIdempotency, markCompleted } = await import('../persistence/idempotencyStore');
    const key = 'ai-apply-U001-rec001';
    markCompleted(key);
    expect(checkIdempotency(key)).toBe('completed');
  });
});
