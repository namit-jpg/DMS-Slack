# Architecture

## High-Level Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Slack User  │────▶│  DMS/SFA App     │────▶│  Salesforce RCG  │
│  (Browser/   │     │  (Node.js/TS)    │     │  (REST API)      │
│   Mobile)    │◀────│  Bolt Framework  │◀────│  Standard Objects│
└─────────────┘     └──────────────────┘     └─────────────────┘
       │                     │                         │
       │ Socket Mode/HTTP    │ App-enforced Auth       │ Standard REST
       │ Slack API            │                         │ API Only
       ▼                     ▼                         ▼
  /wd-dms command       Identity Layer            Existing Objects:
  App Home              1. Resolve email          PurchaseOrder__c
  Interactive Actions   2. Map to Account         Return_Order__c
  Modals                3. Verify access          Invoice__c, etc.
```

## Layers

### 1. Slack Interface Layer (`src/slack/`)
- **Commands**: `/wd-dms` slash command handler
- **App Home**: Publish dashboard on `app_home_opened` event
- **Actions**: Router + individual action handlers (primary orders, GRN, returns, claims, etc.)
- **Blocks**: Reusable Slack Block Kit builders (dashboard, orders, returns, inventory, insights)
- **Modals**: Modal field definitions (future: interactive order creation)

### 2. Service Layer (`src/services/`)
Each DMS business domain has a dedicated service:
- `PrimaryOrderService` - Create/list primary orders (PurchaseOrder__c)
- `GrnService` - Goods receipt notes (GRN__c)
- `ReturnOrderService` - Return orders (Return_Order__c)
- `ClaimService` - Claims (Claim__c)
- `SecondaryOrderService` - Secondary/invoice orders
- `InvoiceService` - View invoices (Invoice__c)
- `DispatchService` - View dispatch requests (Dispatch_Request__c)
- `ArsService` - Auto replenishment settings
- `InsightsService` - Dashboard metrics and business insights

Services depend on `ISalesforceClient` interface, allowing mock/real switching.

### 3. Salesforce Client Layer (`src/salesforce/`)
- **ISalesforceClient**: Clean interface for all Salesforce operations
- **SalesforceRestClient**: Real implementation using standard REST API
- **MockSalesforceClient**: In-memory mock with seeded demo data
- **SalesforceAuth**: OAuth 2.0 (password/client credentials flow)
- **SalesforceClient.ts**: Factory returning mock or real client based on `USE_MOCK_SALESFORCE`

### 4. Identity & Authorization Layer (`src/identity/`)
- **SlackIdentityService**: Resolves Slack user ID -> email via `users.info`
- **DistributorResolver**: Maps email -> Salesforce Distributor Account via:
  1. Contact.Email -> Contact.Distributor__c -> Account
  2. Account.Email__c -> Account directly
- **AuthorizationService**: Enforces app-level authorization
  - Only resolves Account from email (never from user input)
  - Verifies account is active
  - Verifies data access is scoped to the resolved Account

### 5. Persistence Layer (`src/persistence/`)
- **idempotencyStore.ts**: Prevents duplicate record creation (in-memory, auto-TTL)
- **slackStateStore.ts**: Manages Slack interaction state across multi-step flows

### 6. Config Layer (`src/config/`)
- **env.ts**: Zod-validated environment configuration
- **slackConstants.ts**: Centralized Slack action/callback/command/block IDs
- **salesforceObjectMap.ts**: All Salesforce object names and field mappings
- **featureFlags.ts**: Capability flags for Salesforce-dependent features

### 7. Utility Layer (`src/utils/`)
- **logger.ts**: Structured logging with Pino + correlation IDs
- **errors.ts**: Typed error classes (AppError, SalesforceError, AuthorizationError, etc.)
- **result.ts**: Result<T,E> monad for explicit error handling
- **validation.ts**: Zod-based schema validation helpers

## Data Flow

### Command Flow (/wd-dms)
1. User types `/wd-dms` in Slack
2. Slack sends event to Bolt app (Socket Mode)
3. Command handler acks immediately (< 3s)
4. Resolves Slack user email via `users.info`
5. Resolves Distributor Account via email
6. Verifies authorization
7. Fetches dashboard metrics and insights
8. Renders dashboard blocks
9. Responds as ephemeral message

### Record Creation Flow
1. User triggers an action (e.g., create order)
2. Handler acks immediately
3. Generates idempotency key
4. Checks idempotency store (prevents duplicates)
5. Creates record via Salesforce REST API
6. Marks idempotency as completed
7. Responds with confirmation

### Authorization Flow
1. Extract Slack user ID from event
2. Call `users.info` with `users:read.email` scope
3. Get user email from profile
4. Query Salesforce:
   a. Contact WHERE Email = :email
   b. If contact has Distributor__c, get Account
   c. Fallback: Account WHERE Email__c = :email AND IsPartner = true
5. Verify account is active and has distributor business type
6. Scope all subsequent Salesforce operations to this account ID
7. NEVER accept Account ID from Slack user input

## Key Design Decisions

1. **One Salesforce user, many Slack users**: App-enforced authorization
2. **Mock client**: Enables development and testing without Salesforce
3. **Result monad**: Explicit error handling throughout
4. **Blockers documented, not worked around**: If Salesforce doesn't expose a capability, it's documented as a blocker
5. **No Salesforce changes**: Zero Salesforce metadata modifications
6. **Standard REST API only**: No reliance on undocumented Apex REST endpoints
