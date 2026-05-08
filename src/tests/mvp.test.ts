import { describe, it, expect, beforeEach } from 'vitest';
import { MockSalesforceClient } from '../salesforce/MockSalesforceClient';
import { ResolvedDistributorContext, PrimaryOrderQuote, GRNPayload } from '../salesforce/types';

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

describe('MockSalesforceClient - MVP Flows', () => {
  const client = new MockSalesforceClient();
  const ctx = makeContext();

  describe('Products', () => {
    it('returns available products', async () => {
      const products = await client.getAvailableProducts(ctx);
      expect(products.length).toBeGreaterThanOrEqual(5);
      expect(products[0]).toHaveProperty('productId');
      expect(products[0]).toHaveProperty('unitPrice');
      expect(products[0]).toHaveProperty('unitOfMeasure');
    });
  });

  describe('Primary Order Quote', () => {
    it('calculates quote with schemes for multi-product', async () => {
      const quote = await client.calculatePrimaryOrderQuote(ctx, [
        { productId: '01tMOCK000000001', quantity: 10 },
        { productId: '01tMOCK000000002', quantity: 20 },
        { productId: '01tMOCK000000003', quantity: 15 },
      ]);
      expect(quote.appliedSchemes.length).toBeGreaterThan(0);
      expect(quote.schemeDiscount).toBeGreaterThan(0);
      expect(quote.grandTotal).toBeLessThan(quote.totalAmount);
      expect(quote.quoteId).toContain('QT-');
      expect(quote.expiresAt).toBeDefined();
    });

    it('calculates quote without schemes for single product', async () => {
      const quote = await client.calculatePrimaryOrderQuote(ctx, [
        { productId: '01tMOCK000000001', quantity: 5 },
      ]);
      expect(quote.appliedSchemes.length).toBe(0);
      expect(quote.schemeDiscount).toBe(0);
    });

    it('calculates quote with tax', async () => {
      const quote = await client.calculatePrimaryOrderQuote(ctx, [
        { productId: '01tMOCK000000004', quantity: 2 },
        { productId: '01tMOCK000000005', quantity: 50 },
      ]);
      expect(quote.taxAmount).toBeGreaterThan(0);
    });
  });

  describe('Create Primary Order', () => {
    it('creates order from quote', async () => {
      const quote = await client.calculatePrimaryOrderQuote(ctx, [
        { productId: '01tMOCK000000001', quantity: 10 },
      ]);
      const order = await client.createPrimaryOrder(ctx, quote);
      expect(order.orderId).toBeDefined();
      expect(order.orderNumber).toContain('PO-');
      expect(order.status).toBe('Draft');
      expect(order.items.length).toBe(1);
      expect(order.grandTotal).toBe(quote.grandTotal);
    });
  });

  describe('Primary Orders List & Details', () => {
    it('lists orders for distributor', async () => {
      const orders = await client.getPrimaryOrders(ctx);
      expect(orders.length).toBeGreaterThan(0);
      expect(orders[0].distributorId).toBe('001MOCK000000001');
    });

    it('returns empty for other distributor', async () => {
      const otherCtx = makeContext({ salesforceAccountId: '001MOCK000000002' });
      const orders = await client.getPrimaryOrders(otherCtx);
      expect(orders.length).toBe(0);
    });

    it('gets order details by ID', async () => {
      const detail = await client.getPrimaryOrderDetails(ctx, 'a01MOCK000000001');
      expect(detail.orderNumber).toBe('PO-2026-0001');
      expect(detail.items.length).toBeGreaterThan(0);
      expect(detail.fulfillmentStatus).toBeDefined();
      expect(detail.grnIds).toBeDefined();
    });

    it('throws for cross-account order access', async () => {
      const otherCtx = makeContext({ salesforceAccountId: '001MOCK000000002' });
      await expect(client.getPrimaryOrderDetails(otherCtx, 'a01MOCK000000001')).rejects.toThrow();
    });
  });

  describe('GRN Processing', () => {
    it('creates GRN without return order when no damage', async () => {
      const grnData: GRNPayload = {
        items: [{ productId: '01tMOCK000000001', expectedQuantity: 50, receivedQuantity: 50, damagedQuantity: 0, missingQuantity: 0 }],
        notes: 'All good',
      };
      const grn = await client.createOrUpdateGRN(ctx, 'a01MOCK000000001', grnData);
      expect(grn.grnNumber).toContain('GRN-');
      expect(grn.status).toBe('Completed');
      expect(grn.createdReturnOrderId).toBeUndefined();
    });

    it('creates GRN with return order when damage exists', async () => {
      const grnData: GRNPayload = {
        items: [{ productId: '01tMOCK000000001', expectedQuantity: 50, receivedQuantity: 40, damagedQuantity: 5, missingQuantity: 5 }],
        notes: 'Some damaged',
      };
      const grn = await client.createOrUpdateGRN(ctx, 'a01MOCK000000001', grnData);
      expect(grn.createdReturnOrderId).toBeDefined();
    });
  });

  describe('Return Orders', () => {
    it('lists return orders for distributor', async () => {
      const returns = await client.getReturnOrders(ctx);
      expect(returns.length).toBeGreaterThan(0);
      expect(returns[0].accountId).toBe('001MOCK000000001');
    });

    it('gets return order details', async () => {
      const detail = await client.getReturnOrderDetails(ctx, 'a02MOCK000000001');
      expect(detail.returnNumber).toBe('RO-2026-0001');
      expect(detail.approvalStatus).toBeDefined();
      expect(detail.claimIds.length).toBeGreaterThan(0);
      expect(detail.creditNoteIds.length).toBeGreaterThan(0);
    });
  });

  describe('Claims', () => {
    it('lists claims for distributor', async () => {
      const claims = await client.getClaims(ctx);
      expect(claims.length).toBeGreaterThan(0);
    });

    it('creates a claim', async () => {
      const claim = await client.createOrUpdateClaim(ctx, {
        returnOrderId: 'a02MOCK000000001',
        claimType: 'Damaged Goods',
        amount: 500,
        description: 'Test claim',
      });
      expect(claim.claimNumber).toContain('CLM-');
      expect(claim.status).toBe('Submitted');
    });
  });

  describe('File Upload', () => {
    it('uploads a file to a record', async () => {
      const result = await client.uploadFileToRecord(ctx, 'a02MOCK000000001', {
        fileName: 'test.jpg', contentBase64: 'fakebase64', contentType: 'image/jpeg',
      });
      expect(result.fileId).toBeDefined();
      expect(result.contentDocumentId).toBeDefined();
      expect(result.linkedToRecord).toBe('a02MOCK000000001');
    });
  });

  describe('Approval', () => {
    it('gets approval status for approved record', async () => {
      const status = await client.getApprovalStatus(ctx, 'a02MOCK000000001', 'Return_Order__c');
      expect(status.isApproved).toBe(true);
      expect(status.approverName).toBeDefined();
    });

    it('submits for approval', async () => {
      const result = await client.submitForApproval(ctx, 'a02MOCK000000001', 'Return_Order__c');
      expect(result.success).toBe(true);
    });
  });

  describe('Credit Notes', () => {
    it('lists credit notes for distributor', async () => {
      const notes = await client.getCreditNotes(ctx);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0].creditNoteNumber).toContain('CN-');
      expect(notes[0].status).toBe('Issued');
    });
  });
});
