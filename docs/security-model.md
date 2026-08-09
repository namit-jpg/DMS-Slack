# Security Model

## Core Principle

Because this app uses one Salesforce integration user for many Slack users, **Salesforce record-level access cannot be trusted by default**. The app itself must enforce authorization.

## Identity Model

### ResolvedDistributorContext

Every authenticated Slack action produces a `ResolvedDistributorContext`:

```typescript
interface ResolvedDistributorContext {
  slackUserId: string;
  slackTeamId: string;
  slackEnterpriseId: string | null;
  slackEmail: string;
  salesforceAccountId: string;
  accountName: string;
  distributorCode: string | null;
  mappingSource: 'AccountEmail' | 'ContactEmail' | 'PersonAccountEmail' | 'DistributorObject';
  resolvedAt: string;
  isActive: boolean;
  accountType: string;
  businessType: string;
}
```

### Identity Pipeline

The `IdentityPipeline` orchestrates the full resolution:

```
1. SlackIdentityService.resolveUserIdentity()
   └── Slack users.info API → email, team, enterprise ID
   └── Cached for 5 min TTL per slackUserId
   └── Throws EMAIL_NOT_AVAILABLE if email missing

2. DistributorResolver.resolveByEmail()
   ├── Contact.Email → Contact.Distributor__c → Account (mappingSource: ContactEmail)
   ├── Account.Email__c → Account directly (mappingSource: AccountEmail)
   └── Returns controlled errors:
       ├── NOT_MAPPED (404): No account found
       ├── DUPLICATE_MAPPING (409): Multiple accounts with same email
       └── RESOLUTION_ERROR (500): Unexpected error

3. AuthorizationService.verifyContextExists()
   └── Validates context is non-null
   └── Validates account is active
   └── Throws INACTIVE_DISTRIBUTOR if account inactive
```

### Slack User → Distributor Account Mapping

```
Slack User ID  ──▶  Slack API (users.info)  ──▶  Email
                                                      │
                                                      ▼
                                         IdentityPipeline
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                     Contact.Email    Account.Email__c   SFA_User__c.email__c
                           │                │                  │
                     Distributor__c          │                  │
                           │                │                  │
                           ▼                ▼                  ▼
                          Account (Distributor)        (no direct Account link)
```

### Resolution Order
1. Find Contact by Email → use `Contact.Distributor__c` → get Account
2. Fall back: Find Account by `Email__c` where `IsPartner = true`; fail if duplicates
3. Future: Match against `SFA_User__c.email__c` (currently no Account link exists)

## Authorization Rules

### Per-Record Access Control

The `AuthorizationService` enforces ownership on every record access:

```typescript
await auth.assertCanAccessPrimaryOrder(context, orderId);
await auth.assertCanAccessReturnOrder(context, returnOrderId);
await auth.assertCanAccessClaim(context, claimId);
await auth.assertCanAccessInvoice(context, invoiceId);
await auth.assertCanAccessDispatchRequest(context, dispatchId);
await auth.assertCanAccessSecondaryOrder(context, secondaryOrderId);
```

Each method:
1. Validates the ID format (must be a valid Salesforce ID)
2. Queries Salesforce with BOTH the record ID AND the account ID
3. If no record matches, throws `RecordAccessForbiddenError` (403)
4. Logs all denied access attempts with user and account context

### Never Trust User Input
- The Salesforce Account ID must **only** come from the email resolution process
- Slack users can **never** provide, edit, or override the Account ID
- All block/action values referencing an Account ID must be validated against the resolved identity
- Record IDs from Slack action payloads are verified against the resolved Account before use

### Account Scoping
- Every Salesforce read/write operation must include a WHERE clause scoped to the resolved Account ID
- The `ResolvedDistributorContext.salesforceAccountId` provides the scoping boundary
- Cross-account data access is prevented at the application layer

### Account Status Checks
1. Account must exist
2. Account must be a Partner/Distributor (`IsPartner = true` or `Business_Type__c = 'Distributor'`)
3. Account must be active (status checks where applicable)

### Idempotency
- All record-creating operations must use idempotency keys
- Keys are stored in-memory with 24-hour TTL
- Prevents duplicate order/return/claim creation from Slack retries

## Threat Mitigations

### Spoofed User Identity
- **Threat**: User provides someone else's email in Slack input
- **Mitigation**: Email is always resolved from `users.info` API call using the authenticated Slack user token, never from message text

### Cross-Account Access
- **Threat**: User attempts to view/modify another distributor's data
- **Mitigation**: All queries are scoped to the resolved Account ID; any user-provided Account ID is rejected

### Replay Attacks
- **Threat**: Duplicate order/claim submissions from repeated Slack interactions
- **Mitigation**: Idempotency keys tie each operation to a unique Slack interaction

### Salesforce API Abuse
- **Threat**: Rate limiting or data exfiltration via bulk operations
- **Mitigation**: Query LIMIT clauses on all operations; pagination for large result sets

### Error Leakage
- **Threat**: Raw Salesforce errors exposed to Slack users
- **Mitigation**: All Salesforce errors are caught and wrapped with user-friendly messages via `SalesforceError.userMessage`

## Slack Security

### Required Slack Scopes
| Scope | Purpose |
|---|---|
| `commands` | Register `/dms` slash command |
| `chat:write` | Respond to messages |
| `users:read` | Resolve Slack user identity |
| `users:read.email` | Get user email for identity resolution |
| `im:write` | Send DMs (future) |
| `files:read` | Process file uploads (future: claim attachments) |

### Socket Mode vs HTTP
- **Socket Mode**: Token is never exposed over HTTP; recommended for development and internal apps
- **HTTP Mode**: Requires signing secret verification; needed for public endpoints

### Token Storage
- All tokens are environment variables only
- No hardcoded secrets in source code
- `.env` file is in `.gitignore`

## Salesforce Security

### Authentication
- OAuth 2.0 password flow or client credentials flow
- Single integration user with appropriate object CRUD permissions
- Token refresh handled automatically

### Integration User Permissions
The integration user needs:
- `read` on Account, Contact, Product2, Pricebook2, PricebookEntry
- `create`, `read`, `update` on:
  - PurchaseOrder__c, Purchase_Order_Item__c
  - Return_Order__c, Return_Order_Line_Item__c
  - Invoice__c, Invoice_Line_Item__c
  - Claim__c, BulkClaim__c
  - GRN__c, GRN_Line__c
  - Dispatch_Request__c
  - Inventory_Batch__c
- `read` on StoreScheme__c, Scheme_Slab_Target__c
- `read` on SFA_User__c (for email matching)

### Principle of Least Privilege
- The integration user should NOT have:
  - Modify All Data
  - View All Data (if possible with record sharing)
  - Customize Application
  - Manage Users

**Note**: Since record-level security cannot be trusted (one user, many Slack accounts), object-level and field-level permissions are the primary Salesforce-side security control.
