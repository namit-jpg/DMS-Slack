# Salesforce Integration

## Integration Approach

The app uses **only** the standard Salesforce REST API with a single integration user. No custom Apex REST endpoints are created or modified. No metadata is deployed to Salesforce.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Slack App                           │
│                                                      │
│  ISalesforceClient (interface)                        │
│       ▲                    ▲                         │
│       │                    │                         │
│  ┌────┴──────┐    ┌───────┴──────────┐              │
│  │ Mock      │    │ SalesforceRest   │              │
│  │ Client    │    │ Client           │              │
│  │(USE_MOCK) │    │                  │              │
│  └───────────┘    │ SalesforceAuth   │              │
│                   │ (OAuth 2.0)      │              │
│                   └───────┬──────────┘              │
└───────────────────────────┼─────────────────────────┘
                            │ HTTPS
                            ▼
                   ┌────────────────┐
                   │ Salesforce RCG │
                   │ Org            │
                   │                │
                   │ REST API v62.0 │
                   │                │
                   │ Query/CRUD     │
                   │ Describe       │
                   └────────────────┘
```

## Client Interface

```typescript
interface ISalesforceClient {
  query<T>(soql: string): Promise<SalesforceQueryResult<T>>;
  queryAll<T>(soql: string): Promise<SalesforceQueryResult<T>>;
  create(objectName: string, fields: Record<string, unknown>): Promise<string>;
  update(objectName: string, id: string, fields: Record<string, unknown>): Promise<void>;
  delete(objectName: string, id: string): Promise<void>;
  describe(objectName: string): Promise<SalesforceDescribeResult>;
  getRecord<T>(objectName: string, id: string): Promise<T>;
  isMock(): boolean;
}
```

## Authentication

### OAuth 2.0 Password Flow
```bash
POST /services/oauth2/token
  grant_type=password
  client_id=xxx
  client_secret=xxx
  username=rcg.dev@wd.in
  password=xxxSECURITY_TOKEN
```

### OAuth 2.0 Client Credentials Flow
```bash
POST /services/oauth2/token
  grant_type=client_credentials
  client_id=xxx
  client_secret=xxx
```

Token is cached and refreshed automatically before expiry.

## Operations Used

### Query (SOQL)
All data reads use parameterized SOQL queries built by `queryBuilders.ts`. All queries:
- Include LIMIT clauses
- Are scoped to the resolved Distributor Account
- Use the field mappings from `salesforceObjectMap.ts`

Example:
```sql
SELECT Id, Name, Status__c, Total_Amount__c, Grand_Total__c
FROM PurchaseOrder__c
WHERE Distributor__c = '001XXXXXXXXXXXX'
ORDER BY CreatedDate DESC
LIMIT 50
```

### Create
All record creation uses the standard REST API:
```bash
POST /services/data/v62.0/sobjects/PurchaseOrder__c
{
  "Distributor__c": "001XXXXXXXXXXXX",
  "Status__c": "Draft",
  "Total_Amount__c": 12500.00
}
```

### Update
```bash
PATCH /services/data/v62.0/sobjects/PurchaseOrder__c/a01XXXXXXXXXXXX
```

### Delete
Not currently used by the Slack app.

### Describe
Used for discovery and validation (read-only).

## Object Mapping

All Salesforce object and field names are centralized in `src/config/salesforceObjectMap.ts`. This provides:
- Type safety through TypeScript literal types
- Single source of truth for field names
- Isolation from Org-specific naming conventions

## RCG REST Endpoints (Not Currently Used)

The RCG org has many Apex @RestResource classes that the SFA mobile app uses. These are documented but NOT called by the Slack app because:

1. Their exact URL paths and request/response formats are unknown without reading Apex class bodies
2. They likely use SFA_User__c authentication (different from Salesforce OAuth)
3. They may have mobile-specific assumptions

Known endpoints (URL paths unverified):
- `/services/apexrest/RCG_AccountsAPI`
- `/services/apexrest/RCG_GetAllProductsAPI`
- `/services/apexrest/RCG_GetOrdersByAccountNameAPI`
- `/services/apexrest/RCG_PurchaseOrderRestController`
- `/services/apexrest/SchemeController`
- etc. (see `src/salesforce/objectMapping.ts:KNOWN_RCG_REST_ENDPOINTS`)

## Blocked Operations

See [Salesforce Gaps and Blockers](./salesforce-gaps-and-blockers.md) for the complete list of operations that require Salesforce-side changes.

## Mock Mode

When `USE_MOCK_SALESFORCE=true`, the `MockSalesforceClient` provides:
- Pre-seeded demo data (3 distributors, 5 products, sample orders)
- In-memory storage persistence
- No external network calls
- Full API compatibility with the real client
