# RCG DMS/SFA Discovery

Discovery performed against `rcg-dms` org (`rcg.dev@wd.in`) on 2026-05-02.

## Discovery Summary

The RCG org contains a very rich DMS/SFA asset with extensive custom objects, Apex REST endpoints, and business logic for the full distributor management workflow.

## Key Custom Objects

| Object | API Name | Purpose |
|---|---|---|
| Purchase Order | `PurchaseOrder__c` | Primary orders from distributors |
| Purchase Order Item | `Purchase_Order_Item__c` | Line items for purchase orders |
| Return Order | `Return_Order__c` | Return order requests |
| Return Order Line Item | `Return_Order_Line_Item__c` | Line items for returns |
| Invoice | `Invoice__c` | Custom invoices |
| Invoice Line Item | `Invoice_Line_Item__c` | Invoice line items |
| Claim | `Claim__c` | Distributor claims |
| Bulk Claim | `BulkClaim__c` | Bulk claim submissions |
| GRN | `GRN__c` | Goods Receipt Notes |
| GRN Line | `GRN_Line__c` | GRN line items |
| Dispatch Request | `Dispatch_Request__c` | Dispatch/shipment requests |
| Inventory Batch | `Inventory_Batch__c` | Product batch inventory |
| Store Scheme | `StoreScheme__c` | Store-level scheme definitions |
| Scheme Slab Target | `Scheme_Slab_Target__c` | Tiered scheme slab targets |
| SFA User | `SFA_User__c` | SFA mobile app users |
| SFA Performance | `SFA_Performance__c` | User performance metrics |
| Credit Note | `Credit_Note__c` | Credit notes |
| Credit Note Usage | `Credit_Note_Usage__c` | Credit note application records |
| Order with Promotion | `OrderWithPromotion__c` | Orders with applied promotions |
| Distributor Fraud Analytics | `Distributor_Fraud_Analytics__c` | Fraud detection records |
| Distributor Manager Meeting | `Distributor_Manager_Meeting__c` | Meeting records |
| Competing Product | `Competing_Product__c` | Competitor product tracking |
| Product Flag | `Product_Flag__c` | Product flags |
| Replenishment Settings | `Replenishment_Settings__mdt` | ARS metadata type |
| Pricing Discussion | `Pricing_Discussion__c` | Pricing negotiation records |

## Key Apex Classes

### REST API Controllers
- `SFAMobileRESTAPI` — Main SFA mobile REST API
- `SFAAuthenticateAPI` — SFA user authentication
- `RCG_AccountsAPI` — Account retrieval
- `RCG_AccountDetailsOnlyAPI` — Account detail retrieval
- `RCG_GetAllProductsAPI` — Product catalog
- `RCG_GetOrdersByAccountNameAPI` — Orders by account
- `RCG_GetReturnOrdersByAccountNameAPI` — Returns by account
- `RCG_GetInvoicesByAccountNameAPI` — Invoices by account
- `RCG_GetContactByNameAPI` — Contact search
- `RCG_SchemesAPI` — Scheme data
- `RCG_InventoryAPI` — Inventory data
- `RCG_SFA_PerformanceAPI` — User performance
- `RCG_SFA_GETUserPerformanceAPI` — Current user perf
- `RCG_PurchaseOrderRestController` / `PurchaseOrderRest` — Purchase order API
- `RCG_PurchaseOrderDetailsController` — Purchase order detail API
- `RCG_CreateRetailStore` — Retail store creation
- `RCG_SendOtpAPI` / `RCG_VerifyOtpAPI` — OTP auth
- `RCG_VisitRestController` / `VisitById/CheckInCheckOut/Photo/Payments` — Visit APIs
- `RCG_AttendanceAPI` / `RCG_LeaveApplicationAPI` — Attendance
- `RCG_SurveyResponseController` — Surveys
- `RCG_TrainingModuleController` — Training
- `RCG_CollectPaymentAPI` — Payment collection

### Business Logic Controllers
- `SchemeController` / `SchemeCalculationService` — Scheme calculation
- `InventoryController` / `InventoryCalculationService` — Inventory management
- `InventoryTransferController` — Stock transfers
- `InventoryReplenishmentController` / `InventoryPolicyController` — ARS
- `WarehouseInventoryController` / `PortalInventoryController` — Warehouse views
- `OrderBookingController` — Order booking
- `OrderTakingController` / `AdvancedOrderTakingController` — Order taking
- `AdhocOrderingController` — Ad-hoc ordering
- `PlaceOrderComponentControllerWd` — Place order widget
- `OrderListController` / `OrderSummaryController` / `AccountOrdersController` — Order views
- `GrnController` / `GrnLineItemController` — GRN management
- `InvoiceController` / `InvoiceStatusController` — Invoice management
- `SecondaryInvoiceController` / `SecondaryInvoiceCreation` / `SecondaryInvoiceVFController` / `SecondaryOrderBulkInvoiceController` — Secondary invoicing
- `DispatchController` — Dispatch management
- `ClaimController` / `ClaimCreatorController` — Claims management
- `ReturnAnalysisController` — Return analysis
- `DistributorCreditController` — Credit management
- `DistributorProductPerformanceService` — Performance analytics
- `DistributorAccountDataService` — Account data service
- `DistributorFraudBatch` — Fraud analysis
- `DistributorPartnerRequestController` — Partner requests
- `OrderEmailService` — Email notifications
- `OrderMonthlyMetricsService` — Monthly reporting
- `ActiveSchemeSender` — Active scheme notification
- `NonSellableInventoryController` — Non-sellable stock
- `OrderInventoryController` — Order-inventory integration

### Batch/Scheduled Classes
- `AutoReplenishmentBatch` / `AutoReplenishmentScheduler` — ARS jobs
- `InventoryExpiryBatch` / `InventoryExpiryNotificationBatch` — Expiry monitoring
- `PartialInvoiceReminderScheduler` — Invoice reminders
- `DistributorFraudBatch` — Fraud processing

### Agentforce/AI Classes
- `Agent_PopularStoreAnalyzer` — Popular store analysis
- `Agent_CheckInventoryAction` — AI inventory check
- `Agent_CreatePrimaryOrderAction` — AI order creation
- `Agent_GetInventoryPolicies` — AI policy retrieval
- `Agent_CreateInventoryPolicies` — AI policy creation

### Triggers
- `DispatchRequestTriggerHandler` / `TriggerHelper` — Dispatch automation

### Visit Action Classes
- `VisitActionInventory` — Visit inventory view
- `VisitActionCreateOrder` — Visit order creation
- `VisitActionAddOrderItem` — Visit order item add
- `VisitActionCreateCompleteOrder` — Complete order from visit

## Account/Distributor Structure

### Account Object
- Standard `Account` object with custom fields:
  - `Email__c` (Email) — Distributor email
  - `IsPartner` (Checkbox) — Partner portal flag
  - `Distributor__c` (Lookup to Account) — Parent distributor link
  - `Business_Type__c` (Picklist) — Business category
  - `Transport_Facility_Type__c` (Picklist)
  - `RecordTypeId` (Record Type) — Record type support

### Contact Object
- `Contact.Distributor__c` (Lookup to Account) — Distributor Account association
- `Contact.Email` (standard email field)

### SFA User
- `SFA_User__c.email__c` (Email) — User email
- `SFA_User__c.password__c` (Text)
- `SFA_User__c.IsActive__c` (Checkbox)
- `SFA_User__c.OTP_Code__c` (Text)
- **No direct Account lookup** — SFA_User is not directly linked to Account

## Identity Resolution Strategy

Based on discovery, the Slack email -> Distributor Account mapping uses:

**Primary path**: Contact.Email -> Contact.Distributor__c -> Account
**Secondary path**: Account.Email__c -> Account directly (where IsPartner = true)
**Blocked**: SFA_User__c.email__c has no direct Account link (BLK-010)

## Verified @RestResource Endpoints (Discovered via Tooling API)

Four endpoints were verified by reading Apex source code bodies via `SELECT Body FROM ApexClass` Tooling API query:

| Class | URL Mapping | HTTP Method | Description | SFA User Required |
|---|---|---|---|---|
| `PurchaseOrderRest` | `/sfa/mobile/getPurchaseOrdersBySFAUser2/*` | GET | Returns purchase orders for an SFA User | Yes (`sfaUserId` query param) |
| `RCG_InventoryAPI` | `/sfa/mobile/getInventoryData` | GET | Returns Inventory__c records with product details | No |
| `RCG_PurchaseOrderRestController` | `/sfa/mobile/createPurchaseOrder2` | POST | Creates PurchaseOrder__c + Purchase_Order_Item__c records | No (but schema expects Distributor__c + items) |
| `RCG_SchemesAPI` | `/sfa/mobile/getAllSchemes` | GET | Returns active Promotion__c records (schemes) | No |

### Endpoint Details

#### POST /sfa/mobile/createPurchaseOrder2
Accepts JSON body with:
```json
{
  "Distributor__c": "001XXXX",
  "SFA_User__c": "a0XXXX",
  "Order_Date__c": "2026-05-01",
  "Status__c": "Draft",
  "Total_Amount__c": 12500.00,
  "items": [{ "Product__c": "01tXXX", "Quantity__c": 10, "Unit_Price__c": 125.50, "Total_Price__c": 1255.00 }]
}
```
Returns `{ success: true, PurchaseOrderId: "a01XXX" }`

#### GET /sfa/mobile/getAllSchemes
Returns `Promotion__c[]` with all scheme fields including `Status__c`, `Start_Date__c`, `End_Date__c`, `Budget__c`, `Scheme_Type__c`, etc.

#### GET /sfa/mobile/getInventoryData
Returns `StockItemWrapper[]` with product name, category, unit price, current stock, stock status, location.

## Classes Confirmed @AuraEnabled (Not REST)

The following classes use `@AuraEnabled` or are Lightning Component helpers — they cannot be called via standard REST API:

- `SecondaryInvoiceCreation` — `@AuraEnabled createSecondaryInvoice(Id orderId)`
- `SecondaryOrderBulkInvoiceController` — `@AuraEnabled processOrders, fetchOrders, getPageSecondaryOrders`
- `ReturnAnalysisController` — @AuraEnabled
- `DistributorCreditController` — @AuraEnabled
- `InventoryReplenishmentController` — @AuraEnabled
- `InventoryPolicyController` — @AuraEnabled
- `Agent_CheckInventoryAction` — Agentforce action, not REST
- `Agent_CreatePrimaryOrderAction` — Agentforce action, not REST
- `Agent_GetInventoryPolicies` — Agentforce action, not REST
- `Agent_CreateInventoryPolicies` — Agentforce action, not REST

## Process Approvals API

ProcessDefinition records exist in the org. The standard Salesforce Process Approvals REST API (`/services/data/v62.0/process/approvals/`) is likely available but has not been tested with a safe record submission yet.

## ContentVersion / File Upload

ContentVersion records exist in the org with data. The integration user may have create permission on ContentVersion and ContentDocumentLink, enabling file upload from Slack. Needs permission verification with a safe test.

## Standard Salesforce Objects Available

The org also has standard OMS/Einstein objects:
- `Order`, `OrderItem`, `OrderSummary`, `OrderDeliveryGroup`
- `ReturnOrder`, `ReturnOrderLineItem`
- `Invoice`, `InvoiceLine`
- `Claim`, `ClaimItem`, `ClaimCoverage`, `PartnerFundClaim`
- `FulfillmentOrder`
- `CreditMemo`, `CreditMemoLine`
- Standard `Product2`, `Pricebook2`, `PricebookEntry`

These standard objects may have overlapping data with the custom DMS objects.
