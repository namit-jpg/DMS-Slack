import { ISalesforceClient, PrimaryOrder, PrimaryOrderItem, DMSProduct, ResolvedDistributorContext } from '../salesforce/types';
import {
  buildFieldString,
} from '../salesforce/objectMapping';
import {
  buildPurchaseOrdersByDistributorQuery,
  buildProductsQuery,
} from '../salesforce/queryBuilders';
import { SALESFORCE_CUSTOM_OBJECTS, SALESFORCE_FIELD_MAP } from '../config/salesforceObjectMap';
import { createChildLogger } from '../utils/logger';
import { Result, success, failure } from '../utils/result';
import { BlockedBySalesforceCapabilityError } from '../utils/errors';
import {
  checkIdempotency,
  markProcessing,
  markCompleted,
  markFailed,
} from '../persistence/idempotencyStore';

const logger = createChildLogger('PrimaryOrderService');

export class PrimaryOrderService {
  constructor(private sfClient: ISalesforceClient) {}

  async getOrdersByDistributor(
    account: ResolvedDistributorContext,
    correlationId?: string,
  ): Promise<Result<PrimaryOrder[], Error>> {
    const log = correlationId
      ? createChildLogger('PrimaryOrderService', correlationId)
      : logger;

    try {
      const result = await this.sfClient.query<{
        Id: string;
        OrderNumber: string;
        AccountId: string;
        Status: string;
        EffectiveDate: string;
        TotalAmount?: number;
        Grand_Total__c?: number;
        Discount_Amount__c?: number;
        Tax_Amount__c?: number;
        Approval_Status__c?: string;
        Description?: string;
      }>(
        buildPurchaseOrdersByDistributorQuery(account.salesforceAccountId),
        correlationId,
      );

      const orders: PrimaryOrder[] = result.records.map((r) => ({
        orderId: r.Id,
        orderNumber: r.OrderNumber,
        distributorId: r.AccountId,
        status: r.Status,
        totalAmount: r.TotalAmount || r.Grand_Total__c || 0,
        schemeDiscount: 0,
        discountAmount: r.Discount_Amount__c || 0,
        grandTotal: r.Grand_Total__c || r.TotalAmount || 0,
        taxAmount: r.Tax_Amount__c || 0,
        orderDate: r.EffectiveDate,
        approvalStatus: r.Approval_Status__c || r.Status,
        notes: r.Description,
        items: [],
      }));

      return success(orders);
    } catch (err) {
      log.error({ err }, 'Failed to fetch orders');
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async createOrder(
    account: ResolvedDistributorContext,
    items: Array<{ productId: string; quantity: number; unitOfMeasure?: string }>,
    idempotencyKey: string,
    correlationId?: string,
  ): Promise<Result<PrimaryOrder, Error>> {
    const log = correlationId
      ? createChildLogger('PrimaryOrderService', correlationId)
      : logger;

    const existing = checkIdempotency(idempotencyKey);
    if (existing === 'completed') {
      log.info({ idempotencyKey }, 'Order already created (idempotent)');
      return success(this.buildMockOrder(account, items));
    }
    if (existing === 'processing') {
      log.info({ idempotencyKey }, 'Order creation in progress');
      return failure(new Error('Order creation is already in progress.'));
    }

    markProcessing(idempotencyKey);

    try {
      const productIds = items.map((i) => i.productId);
      const products = await this.fetchProducts(productIds, correlationId);

      let totalAmount = 0;
      const lineItems: PrimaryOrderItem[] = items.map((item, idx) => {
        const product = products.find(
          (p) => p.productId === item.productId,
        );
        const unitPrice = product?.unitPrice || 0;
        const lineTotal = unitPrice * item.quantity;
        totalAmount += lineTotal;

        return {
          itemId: `item-${idx}-${item.productId.slice(-4)}`,
          productId: item.productId,
          productName: product?.productName || 'Unknown Product',
          productCode: product?.productCode || '',
          quantity: item.quantity,
          unitPrice,
          totalPrice: lineTotal,
          unitOfMeasure: item.unitOfMeasure || product?.unitOfMeasure || 'Each',
        };
      });

      const PO = SALESFORCE_FIELD_MAP.PURCHASE_ORDER;
      const recordData: Record<string, unknown> = {
        [PO.DISTRIBUTOR]: account.salesforceAccountId,
        Distributor_Account__c: account.salesforceAccountId,
        [PO.STATUS]: 'Draft',
        [PO.ORDER_DATE]: new Date().toISOString().split('T')[0],
        [PO.GRAND_TOTAL]: totalAmount,
        [PO.DISCOUNT_AMOUNT]: 0,
        [PO.TAX_AMOUNT]: 0,
        Order_Products__c: lineItems
          .map((li) => `${li.productCode || li.productId}: ${li.quantity} ${li.unitOfMeasure || ''}`.trim())
          .join('\n'),
        [PO.NOTES]: `Created from Slack DMSFA for ${account.accountName} (${account.slackEmail})`,
      };

      if (this.sfClient.isMock()) {
        this.sfClient.isMock();
      }

      const orderId = await this.sfClient.create(
        SALESFORCE_CUSTOM_OBJECTS.PURCHASE_ORDER,
        recordData,
        correlationId,
      );

      const orderName = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;

      const primaryOrder: PrimaryOrder = {
        orderId,
        orderNumber: orderName,
        distributorId: account.salesforceAccountId,
        status: 'Draft',
        totalAmount,
        schemeDiscount: 0,
        discountAmount: 0,
        grandTotal: totalAmount,
        taxAmount: 0,
        orderDate: new Date().toISOString().split('T')[0],
        items: lineItems,
        approvalStatus: 'Pending',
      };

      markCompleted(idempotencyKey, primaryOrder);
      return success(primaryOrder);
    } catch (err) {
      log.error({ err }, 'Failed to create order');
      markFailed(idempotencyKey);
      return failure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async getSchemeCalculation(
    accountId: string,
    items: Array<{ productId: string; quantity: number }>,
    correlationId?: string,
  ): Promise<Result<{ schemeDiscount: number; appliedScheme?: string }, Error>> {
    const log = correlationId
      ? createChildLogger('PrimaryOrderService', correlationId)
      : logger;

    if (this.sfClient.isMock()) {
      return success({ schemeDiscount: items.length > 2 ? 10.5 : 0, appliedScheme: 'Mock Volume Discount' });
    }

    log.warn('Scheme calculation: RCG_SchemesAPI endpoint not available');
    return failure(
      new BlockedBySalesforceCapabilityError(
        'Scheme calculation via REST API',
      ),
    );
  }

  private async fetchProducts(
    ids: string[],
    correlationId?: string,
  ): Promise<DMSProduct[]> {
    try {
      const result = await this.sfClient.query<{
        Id: string;
        Name: string;
        ProductCode: string;
        Family: string;
        Product_Category__c: string;
        Unit_Of_Measure__c: string;
        Unit_Price__c: number;
        Pack_Size__c: number;
        IsActive: boolean;
        Minimum_Order_Quantity_Primary__c: number;
        Minimum_Order_Quantity_Secondary__c: number;
      }>(buildProductsQuery(ids), correlationId);

      return result.records.map((r) => ({
        productId: r.Id,
        productCode: r.ProductCode,
        productName: r.Name,
        family: r.Family,
        category: r.Product_Category__c,
        unitOfMeasure: r.Unit_Of_Measure__c,
        unitPrice: r.Unit_Price__c || 0,
        packSize: r.Pack_Size__c || 0,
        isActive: r.IsActive,
        minOrderQtyPrimary: r.Minimum_Order_Quantity_Primary__c ?? null,
        minOrderQtySecondary: r.Minimum_Order_Quantity_Secondary__c ?? null,
      }));
    } catch {
      return ids.map((id) => ({
        productId: id,
        productCode: '',
        productName: 'Product ' + id,
        family: '',
        category: '',
        unitOfMeasure: 'Each',
        unitPrice: 0,
        packSize: 0,
        isActive: true,
        minOrderQtyPrimary: null,
        minOrderQtySecondary: null,
      }));
    }
  }

  private buildMockOrder(
    account: ResolvedDistributorContext,
    items: Array<{ productId: string; quantity: number }>,
  ): PrimaryOrder {
    return {
      orderId: 'mock-order-' + Date.now(),
      orderNumber: 'PO-MOCK-' + Date.now().toString().slice(-4),
      distributorId: account.salesforceAccountId,
      status: 'Draft',
      totalAmount: items.length * 100,
      schemeDiscount: 0,
      discountAmount: 0,
      grandTotal: items.length * 100,
      taxAmount: 0,
      orderDate: new Date().toISOString().split('T')[0],
      items: items.map((i) => ({
        itemId: 'mock-item-' + i.productId,
        productId: i.productId,
        productName: 'Product ' + i.productId,
        productCode: 'MOCK-' + i.productId.slice(-4),
        quantity: i.quantity,
        unitPrice: 100,
        totalPrice: 100 * i.quantity,
        unitOfMeasure: 'Each',
      })),
      approvalStatus: 'Pending',
    };
  }
}
