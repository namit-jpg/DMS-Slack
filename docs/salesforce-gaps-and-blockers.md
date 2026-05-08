# Salesforce Gaps and Blockers

This document catalogs DMS/SFA features that cannot be fully implemented through Slack because they require Salesforce-side changes not available through the existing standard REST API.

## Summary

| ID | Feature | Status | Workaround Available |
|---|---|---|---|
| BLK-001 | Scheme/Offer Calculation | Blocked | Partial |
| BLK-002 | Pricing/Quote Calculation | Blocked | Partial |
| BLK-003 | Inventory Validation at Order Time | Blocked | Mock only |
| BLK-004 | Partial Invoice / Secondary Order Logic | Blocked | Mock only |
| BLK-005 | Approval Workflow (Submit) | Limited | Read-only |
| BLK-006 | Return Order Auto-Calculation | Blocked | Partial |
| BLK-007 | Credit Note Generation | Blocked | Read-only |
| BLK-008 | ARS Logic (Auto Replenishment) | Blocked | Mock only |
| BLK-009 | AI Insights (Agentforce/Einstein) | Blocked | Mock only |
| BLK-010 | Distributor Email Mapping (SFA_User) | Gap | Yes |
| BLK-011 | SFA Mobile REST API Reuse | Blocked | N/A |
| BLK-012 | REST Endpoint URL Discovery | Methodology | N/A |
| BLK-013 | Primary Order Quote Calculation | Blocked | Mock only |
| BLK-014 | GRN Auto-Return-Order Generation | Uncertain | Partial |
| BLK-015 | File Upload via ContentVersion | Uncertain | Mock only |
| BLK-016 | Secondary Order Detail Retrieval | Blocked | Mock only |
| BLK-017 | Invoice Partial Fulfillment | Blocked | Mock only |
| BLK-018 | Dispatch Auto-Creation | Blocked | Mock only |
| BLK-019 | ARS Toggle via REST | Blocked | Mock only |
| BLK-020 | AI Stock Threshold Application | Blocked | Mock only |

## Detailed Blockers

### BLK-001: Scheme/Offer Calculation
- **What**: Discount calculation based on order volume, product mix, and active schemes
- **Why blocked**: `RCG_SchemesAPI` (`/sfa/mobile/getAllSchemes`) returns `Promotion__c[]` (GET). Scheme calculation logic (`SchemeCalculationService`) is AuraEnabled only, not REST. While scheme data is readable via REST, the calculation logic is not exposed.
- **Status change**: Real scheme data is now discoverable via REST. Scheme calculation remains blocked because the calculation service is `@AuraEnabled` only, not `@RestResource`.
- **Workaround**: Fetch scheme data via `DISCOVERED_RCG_REST_ENDPOINTS.GET_ALL_SCHEMES`. Compute discounts client-side using scheme slab data from `Scheme_Slab_Target__c`. Not ideal but workable.
- **Slack behavior**: Mock mode computes volume discounts. Real mode can now read scheme data for display. Scheme calculation still requires client-side logic.

### BLK-002: Pricing Calculation
- **What**: Dynamic pricing based on schemes, promotions, and volume tiers
- **Why blocked**: Pricing logic in `SchemeCalculationService`, `B2BPricingSample` not exposed via REST
- **Workaround**: Use static prices from `Product2.Unit_Price__c` field. If pricing triggers fire on PurchaseOrder__c insertion, the Slack-created order gets correct pricing
- **Slack behavior**: Calculates line totals from product unit prices; scheme discounts are zero

### BLK-003: Inventory Validation at Order Time
- **What**: Real-time stock check before order submission
- **Why blocked**: `RCG_InventoryAPI` (`/sfa/mobile/getInventoryData`) queries `Inventory__c` (standard object with `Total_Quantity__c`, `Status__c`, `Location_Bin__c`), NOT `Inventory_Batch__c` as previously assumed.
- **Status change**: Inventory data is now readable via REST for current stock levels. Real-time validation is partially possible.
- **Workaround**: Call `DISCOVERED_RCG_REST_ENDPOINTS.GET_INVENTORY_DATA` for stock levels. Query `Inventory_Batch__c` for batch-level detail. Validate client-side before orders.
- **Slack behavior**: Inventory status display now uses discovered REST endpoint. Order validation can check stock levels.

### BLK-004: Partial Invoice Logic
- **What**: Partial invoicing from partial dispatches
- **Why blocked**: `SecondaryInvoiceController`, `SecondaryInvoiceCreation` REST contracts unknown
- **Workaround**: None. Feature returns error until endpoints are documented
- **Slack behavior**: Returns error message when secondary order creation is attempted

### BLK-005: Approval Workflow
- **What**: Approve/reject purchase orders from Slack
- **Why blocked**: Approval processes are declarative/Apex in Salesforce, not exposed as REST endpoints
- **Workaround**: Approval status is read-only in Slack. Approvals must happen in Salesforce UI
- **Slack behavior**: Shows approval status (Pending/Approved/Rejected) but cannot modify it

### BLK-006: Return Order Auto-Calculation
- **What**: Automatic scheme reversal and return analysis on return order creation
- **Why blocked**: `ReturnAnalysisController` REST endpoint contract unknown
- **Workaround**: Create Return_Order__c via standard REST API. If triggers auto-calculate fields, they populate automatically
- **Slack behavior**: Creates return order with manual fields; scheme reversal may not be computed

### BLK-007: Credit Note Generation
- **What**: Automatic credit note creation for returns and claims
- **Why blocked**: No visible REST endpoint for credit note generation
- **Workaround**: Create `Credit_Note__c` records via standard REST API if triggers auto-generate them
- **Slack behavior**: Does not currently create credit notes

### BLK-008: ARS Logic (Auto Replenishment)
- **What**: Automated stock replenishment based on thresholds
- **Why blocked**: `AutoReplenishmentBatch` and `InventoryReplenishmentController` REST contracts unknown
- **Workaround**: Display inventory levels and allow manual reorder from Slack. Auto-replenishment runs on its own schedule in Salesforce
- **Slack behavior**: Read-only view of ARS settings (mock mode only); manual ordering available

### BLK-009: AI Insights
- **What**: AI-driven business insights, order recommendations, fraud detection
- **Why blocked**: Agentforce/Einstein actions (`Agent_CheckInventoryAction`, `Agent_CreatePrimaryOrderAction`) not available via REST
- **Workaround**: Basic metrics computed client-side from order history and inventory data
- **Slack behavior**: Shows basic dashboard metrics; "Insights Preview" placeholder in live mode

### BLK-010: Distributor Email Mapping
- **What**: Direct email-to-Account mapping via SFA_User__c for Slack identity resolution
- **Why blocked**: `SFA_User__c` has `email__c` but no Account lookup field
- **Workaround**: Two-step resolution: (1) Contact.Email → Contact.Distributor__c → Account, (2) Account.Email__c → Account (with duplicate detection). All resolution paths are actively used by `DistributorResolver.resolveByEmail()`.
- **Slack behavior**: Uses Contact and Account paths; duplicate emails throw DUPLICATE_MAPPING (409) error with admin contact message
- **Status**: Working with workaround. SFA_User__c path is documented as a future enhancement.

### BLK-013: Primary Order Quote/Pricing Calculation via REST
- **What**: Calculate quotes with scheme discounts, tax, and offers before order creation
- **Why blocked**: `SchemeCalculationService` and `RCG_SchemesAPI` exist but REST endpoint paths and formats are unknown
- **Workaround**: Mock mode computes volume-based scheme discounts (5% for 2 items, 10% for 3+ items) and 9% tax. Real mode uses static product prices from `Product2.Unit_Price__c` without scheme calculation.
- **Slack behavior**: Product selection -> Review step shows mock-calculated quote in mock mode. Real mode returns error directing user to BLK-002.
- **Suggested change**: Document `RCG_SchemesAPI` and `OrderBookingController` REST endpoint contracts

### BLK-014: Automatic Return Order Generation from GRN
- **What**: When GRN records damaged/missing quantities, existing Salesforce triggers should create a Return Order automatically
- **Why uncertain**: The existence of `DispatchRequestTriggerHandler` suggests trigger-based automation exists, but whether it fires on GRN__c + PurchaseOrder__c record updates is unknown without reading Apex trigger bodies
- **Workaround**: Mock mode simulates auto-creation of Return Order when damaged/missing > 0. Real mode: if triggers fire, Return Order appears; if not, it's a blocker to report.
- **Slack behavior**: GRN confirmation shows "Return Order Created: [ID]" if auto-generated; silent otherwise

### BLK-015: File Upload via ContentVersion/ContentDocumentLink
- **What**: Upload Slack files (proof images, invoices) to Salesforce records
- **Why uncertain**: Requires the Salesforce integration user to have ContentVersion create and ContentDocumentLink create permissions. Unknown if the RCG org allows this for the integration user.
- **Workaround**: Mock mode simulates upload returning file IDs. Real mode: if the integration user has content permissions, uploads work via standard REST API. If not, file upload is blocked.
- **Slack behavior**: Mock mode uploads successfully. Real mode returns error if permissions insufficient.

### BLK-016: Secondary Order Detail Retrieval via REST
- **What**: Fetch full secondary order details including line items, fulfillment, dispatch, and invoice status
- **Why blocked**: `SecondaryOrderBulkInvoiceController` and `OrderSummaryController` exist but REST endpoint contracts unknown (BLK-004, BLK-012)
- **Workaround**: Mock mode returns full detail with line items, inventory availability, dispatch info. Real mode queries `Invoice__c WHERE Type__c = 'Secondary'` and returns basic data only.
- **Slack behavior**: Full detail view in mock mode; limited view in real mode

### BLK-017: Invoice Partial Fulfillment via REST
- **What**: Create partial invoices when stock is insufficient for full order fulfillment
- **Why blocked**: `SecondaryInvoiceCreation` and `SecondaryInvoiceController` REST endpoints not documented (BLK-004)
- **Workaround**: Mock mode creates invoices via `Invoice__c` record creation and returns updated line item data. Real mode creates a basic `Invoice__c` record but cannot link line items or compute partial/shortfall quantities.
- **Slack behavior**: Mock mode shows full/partial invoice creation; real mode creates the record but without line-level detail

### BLK-018: Dispatch Auto-Creation from Invoice
- **What**: Salesforce auto-creates `Dispatch_Request__c` records when invoices are created
- **Why blocked**: `DispatchController` exists but REST endpoint path unknown. Unknown whether invoice creation triggers dispatch via existing Apex triggers/flows.
- **Workaround**: Mock mode simulates dispatch creation. Real mode: after invoice creation, query `Dispatch_Request__c` for the order to check if triggers created them automatically.
- **Slack behavior**: Mock mode returns pre-seeded dispatch data. Real mode returns empty or error.

### BLK-019: ARS Toggle via REST
- **What**: Toggle Auto Replenishment System on/off from Slack
- **Why blocked**: `InventoryReplenishmentController` and `InventoryPolicyController` exist but REST endpoints not documented (BLK-008). No standard object field for ARS toggle exists on accessible objects.
- **Workaround**: Mock mode toggles internal `autoReplenishmentEnabled` flag. Real mode throws error directing user to BLK-008.
- **Slack behavior**: Full toggle in mock with idempotency; error in real mode

### BLK-020: AI Stock Threshold Application via REST
- **What**: Apply AI-suggested stock threshold changes to existing Salesforce records
- **Why blocked**: `Agent_GetInventoryPolicies` and `Agent_CreateInventoryPolicies` exist but not accessible via REST API (BLK-009). No documented endpoint for modifying inventory policy records.
- **Workaround**: Mock mode marks the recommendation as applied and returns updated config. Real mode throws error.
- **Slack behavior**: Full flow in mock mode with idempotency; error in real mode directing user to BLK-009.

### BLK-011: SFA Mobile REST API Reuse
- **What**: Use existing SFA mobile REST endpoints from Slack
- **Why blocked**: SFA mobile APIs use `SFA_User__c` authentication (password + OTP), not Salesforce OAuth
- **Workaround**: N/A — Use standard Salesforce REST API with integration user token instead
- **Slack behavior**: All operations use standard REST API, not SFA mobile endpoints

### BLK-012: REST Endpoint URL Discovery
- **What**: Discover exact URL paths for Apex @RestResource classes
- **Why blocked**: Tooling API cannot read Apex class source code/URL mappings
- **Workaround**: Document all known endpoint names; await URL path documentation from Salesforce team
- **Impact**: 12+ documented REST endpoints cannot be called because their URL paths are unknown

## How to Resolve Blockers

For each blocker, the recommended Salesforce-side change is documented in the `suggestedSalesforceChange` field. Key patterns:

1. **Document REST endpoints**: Provide URL paths, HTTP methods, request/response schemas for all RCG REST classes
2. **Add direct Account lookup to SFA_User__c**: Enables single-step email-to-Account mapping
3. **Expose AI actions**: Document how to invoke Agentforce actions via REST

## What Already Works Without Salesforce Changes

- Primary order creation (PurchaseOrder__c via standard REST)
- Primary order listing (query with Account scope)
- Return order creation (Return_Order__c via standard REST)
- Return order listing
- Claim creation (Claim__c via standard REST)
- Claim listing
- GRN creation (GRN__c via standard REST)
- Invoice listing (Invoice__c via standard REST)
- Dispatch request listing (Dispatch_Request__c via standard REST)
- Inventory batch listing (Inventory_Batch__c via standard REST)
- Dashboard metrics (computed from query results)
- Basic business insights (computed from data)
