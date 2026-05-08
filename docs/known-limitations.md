# Known Limitations

## Authentication & Identity

1. **One Salesforce user, many Slack users**: The app uses a single Salesforce integration user credential. All Slack users share this credential. Authorization is app-enforced, not Salesforce-enforced.
2. **Email resolution dependency**: If a Slack user's email is not linked to any Salesforce Contact or Account, they cannot use the app. The SFA_User__c object has email but no Account link (BLK-010).
3. **No SSO/SAML**: Slack users authenticate to Slack, not Salesforce. No identity federation.

## Salesforce Integration

4. **Standard REST API only**: Cannot use RCG mobile REST endpoints (BLK-011, BLK-012). All operations use standard Salesforce REST API (query, create, update) which may not trigger all existing Apex automations.
5. **No scheme calculation in Slack**: Pricing and discounts are limited to static product prices (BLK-001, BLK-002).
6. **Read-only approvals**: Approvals must happen in Salesforce UI, not Slack (BLK-005).
7. **Partial invoice blocked**: Secondary/invoice orders are not fully functional (BLK-004).
8. **AI insights limited**: Agentforce actions not available via REST (BLK-009).
9. **No credit note generation from Slack** (BLK-007).
10. **ARS settings read-only**: Auto replenishment settings can be viewed but not configured from Slack (BLK-008).

## Slack UI

11. **No rich product catalog browser**: Products listed as text, not rich cards.
12. **No interactive order form**: Order creation currently uses text-based flow (modal forms planned for Phase 2).
13. **No file upload support**: Claim attachments not yet implemented (planned).
14. **Message-only interaction**: No Slack canvas or workflow integration.
15. **Ephemeral responses only**: Dashboard is shown as ephemeral, not in channel.

## Data & Performance

16. **In-memory state stores**: Idempotency and state stores are in-memory (lost on restart). No Redis/Postgres persistence yet.
17. **No pagination**: Result sets limited to 50-100 records per query.
18. **No real-time updates**: Dashboard does not auto-refresh.
19. **Single instance**: No horizontal scaling support yet.

## Security

20. **App-enforced authorization**: Record-level security depends on correct implementation of app-level scoping. There is no defense-in-depth from Salesforce sharing rules.
21. **No audit trail**: Slack actions are not audited at the Salesforce level (audit trail exists via CreatedById on records).
22. **No MFA for Slack users**: Identity verification relies on Slack auth only.

## Operations

23. **No retry mechanism for failed Salesforce calls**: If a record creation fails after the initial HTTP call, the idempotency is marked as failed and user must retry.
24. **No graceful degradation**: If Salesforce is unreachable, the Slack app returns errors rather than cached data.
25. **Manual mock/Live switching**: Requires restart with different env vars.
26. **Secondary Order polling only**: No outbound Salesforce event integration. Polling every 5 minutes means up to 5-minute delay on notifications. Poller targets hardcoded email list in mock mode.

## Secondary Orders

27. **Inventory availability blocked in real mode**: `getInventoryAvailability` queries `Inventory_Batch__c` but requires `RCG_InventoryAPI` endpoint for real-time validation (BLK-003).
28. **Partial invoice logic blocked**: `SecondaryInvoiceCreation` and `SecondaryOrderBulkInvoiceController` REST endpoints not documented (BLK-004). Mock mode simulates partial invoice creation.
29. **Dispatch auto-creation not guaranteed**: Salesforce may or may not auto-create `Dispatch_Request__c` records from invoice creation (BLK-004).

## ARS

30. **ARS config blocked in real mode**: `InventoryReplenishmentController` and `InventoryPolicyController` REST endpoints not documented (BLK-008). Mock mode shows full ARS dashboard.
31. **ARS toggle blocked**: No documented REST endpoint exists for toggling ARS activation (BLK-008). Mock mode allows toggle with idempotency.
32. **ARS triggered orders blocked**: `AutoReplenishmentBatch` runs on schedule in Salesforce but no REST API exposes triggered order history (BLK-008).

## AI Insights

33. **AI insights blocked in real mode**: `Agent_CheckInventoryAction`, `Agent_CreatePrimaryOrderAction`, and other Agentforce actions not available via REST API (BLK-009). Mock mode returns 4 insight types with applied/label indicators.
34. **Stock threshold AI blocked**: Recommendations cannot be fetched or applied through existing APIs (BLK-009). Mock mode allows viewing and applying with confidence scoring.
35. **Upsell recommendations blocked**: Retailer growth recommendations not available via REST API (BLK-009). Mock mode shows scored recommendations with estimated revenue.

## Platform

26. **Node.js only**: No container orchestration, no multi-region deployment.
27. **Single Slack workspace**: Designed for one workspace per app instance.
28. **Socket Mode dependency**: The app is designed primarily for Socket Mode; HTTP mode is supported but less tested.

## Mitigations

| Limitation | Mitigation |
|---|---|
| App-enforced auth | Strict email resolution, no user-provided Account ID |
| No scheme calculation | Use PurchaseOrder__c creation with existing triggers |
| In-memory stores | Low-volume operational use acceptable; Phase 5 adds persistence |
| No real-time | `/wd-dms` command re-queries on each invocation |
| Read-only approvals | Clear messaging in Slack; directs users to Salesforce UI |
| Blocked features | Documented in `salesforce-gaps-and-blockers.md` with workarounds |
