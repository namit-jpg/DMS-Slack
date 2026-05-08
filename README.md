# DMS/SFA Slack Application

Slack-first DMS/SFA application backed by Salesforce, enabling distributors to perform DMS/SFA work directly from Slack without individual Salesforce licenses.

## Architecture Overview

- **Frontend**: Slack (Bolt for JavaScript, Socket Mode)
- **Backend**: Node.js + TypeScript
- **System of Record**: Salesforce (RCG DMS/SFA org)
- **Identity**: Slack User Email -> Salesforce Distributor Account
- **Authorization**: App-enforced scoping; one Salesforce integration user, many Slack users

## Quick Links

- [Architecture](docs/architecture.md)
- [Security Model](docs/security-model.md)
- [RCG Discovery](docs/rcg-discovery.md)
- [Salesforce Integration](docs/salesforce-integration.md)
- [Salesforce Gaps & Blockers](docs/salesforce-gaps-and-blockers.md)
- [Slack App Setup](docs/slack-app-setup.md)
- [Implementation Phases](docs/implementation-phases.md)
- [Known Limitations](docs/known-limitations.md)

## Prerequisites

- Node.js 22+
- npm 10+
- A Slack workspace with permission to install apps
- A Salesforce org with RCG DMS/SFA metadata (for live mode)
- Salesforce CLI (optional, for discovery)

## Local Setup

```bash
# Clone and install
git clone <repo-url>
cd DMSFA
npm install

# Copy environment file
cp .env.example .env

# Start in mock mode (no Salesforce connection needed)
npm run dev

# Run tests
npm test

# Type check
npm run typecheck
```

## Slack App Setup

1. Go to https://api.slack.com/apps
2. Create a new app from manifest (or from scratch)
3. Enable Socket Mode
4. Add required **Bot Token scopes**:
   - `commands` — Register `/wd-dms` slash command
   - `chat:write` — Respond to messages
   - `users:read` — Resolve Slack user identity
   - `users:read.email` — Get Slack user email for Salesforce Account mapping
   - `im:write` — Send DMs (future)
   - `files:read` — Process file uploads (future)
5. Create slash command `/wd-dms`
6. Subscribe to `app_home_opened` bot event
7. Install the app to your workspace
8. Copy tokens to `.env`

See [docs/slack-app-setup.md](docs/slack-app-setup.md) for detailed instructions.

## Salesforce Connected App Setup

1. Create a Connected App in Salesforce Setup
2. Enable OAuth with client credentials flow
3. For password flow, ensure password policies allow API login
4. Copy client ID and secret to `.env`

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | - | Slack Bot User OAuth Token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | In HTTP mode | - | Slack Signing Secret |
| `SLACK_APP_TOKEN` | Socket mode | - | Slack App-Level Token (xapp-...) |
| `SLACK_SOCKET_MODE` | No | `true` | Use Socket Mode instead of HTTP |
| `SALESFORCE_LOGIN_URL` | No | `https://login.salesforce.com` | Salesforce auth URL |
| `SALESFORCE_CLIENT_ID` | Live mode | - | Connected App Client ID |
| `SALESFORCE_CLIENT_SECRET` | Live mode | - | Connected App Client Secret |
| `SALESFORCE_USERNAME` | Password flow | - | Salesforce integration username |
| `SALESFORCE_PASSWORD` | Password flow | - | Salesforce integration password |
| `SALESFORCE_SECURITY_TOKEN` | No | - | Salesforce security token |
| `USE_MOCK_SALESFORCE` | No | `true` | Use mock Salesforce client |
| `LOG_LEVEL` | No | `info` | Logging level |
| `PORT` | No | `3000` | HTTP port (non-socket mode) |

## Running in Mock Mode

```bash
USE_MOCK_SALESFORCE=true npm run dev
```

The mock Salesforce client simulates the RCG org's objects (distributors, products, orders, etc.) with seeded demo data. All Slack flows work without a real Salesforce connection.

## Running Against Salesforce

```bash
USE_MOCK_SALESFORCE=false SALESFORCE_CLIENT_ID=xxx SALESFORCE_CLIENT_SECRET=xxx SALESFORCE_USERNAME=xxx SALESFORCE_PASSWORD=xxx SALESFORCE_SECURITY_TOKEN=xxx npm run dev
```

Uses the standard Salesforce REST API with the integration user's credentials. All DMS objects (PurchaseOrder__c, Return_Order__c, Invoice__c, Claim__c, etc.) are accessed via the integration user with app-enforced authorization.

## Running the Live Slack App Locally

For the WD RCG SFA DMS Slack app, keep `.env` populated with the real Slack and Salesforce values, then start the server from PowerShell:

```powershell
cd C:\Users\namit\Documents\DMSFA
$env:USE_MOCK_SALESFORCE='false'
$env:SALESFORCE_AUTH_MODE='SF_CLI'
npm.cmd start
```

If Slack is configured through ngrok, keep ngrok running against the HTTP listener:

```powershell
ngrok http 3001
```

The Slack request URL in the app manifest must point to the ngrok HTTPS URL plus `/slack/events`.

## Demo Flow

1. Start the app in mock mode: `npm run dev`
2. In Slack, type `/wd-dms`
3. The dashboard renders with metrics and insights
4. Navigate: My Primary Orders, Returns & Claims, Business Insights, ARS Settings
5. All data is pre-seeded mock data

## Important Warning

**Absolutely no Salesforce-side implementation changes are allowed.** This app uses existing Salesforce objects, APIs, and automation as-is. Any required Salesforce-side changes are documented as blockers in [docs/salesforce-gaps-and-blockers.md](docs/salesforce-gaps-and-blockers.md).

## Project Structure

```
src/
  app.ts                    # App factory
  server.ts                 # Entry point
  config/                   # Configuration layer
    env.ts                  # Environment validation (Zod)
    slackConstants.ts       # Centralized Slack IDs
    salesforceObjectMap.ts  # SF object/field constants
    featureFlags.ts         # Feature flag definitions
  slack/                    # Slack interface layer
    commands/               # Slash command handlers
    appHome/                # App Home publisher
    actions/                # Interactive action handlers
    modals/                 # Modal definitions
    blocks/                 # Block kit builders
  salesforce/               # Salesforce client layer
    SalesforceClient.ts     # Client factory
    SalesforceRestClient.ts # Real REST client
    MockSalesforceClient.ts # Mock client for dev/test
    SalesforceAuth.ts       # OAuth handler
    types.ts                # TypeScript interfaces
    objectMapping.ts        # Object/field/endpoint maps
    queryBuilders.ts        # SOQL query builders
    blockers.ts             # Documented Salesforce gaps
  identity/                 # Identity & auth layer
    SlackIdentityService.ts # Slack user resolution
    DistributorResolver.ts  # Email -> Account resolver
    AuthorizationService.ts # App-enforced auth
  services/                 # Business logic services
    PrimaryOrderService.ts
    GrnService.ts
    ReturnOrderService.ts
    ClaimService.ts
    SecondaryOrderService.ts
    InvoiceService.ts
    DispatchService.ts
    ArsService.ts
    InsightsService.ts
  persistence/              # Lightweight in-memory stores
    idempotencyStore.ts     # Idempotency for record creation
    slackStateStore.ts      # Slack interaction state
  utils/                    # Utilities
    logger.ts               # Structured logging (Pino)
    errors.ts               # Error classes
    result.ts               # Result monad
    validation.ts           # Zod validation helpers
  tests/                    # Test files
```

## Available Features (Mock Mode)

- `/wd-dms` command with dashboard
- App Home dashboard
- Primary Order creation and listing
- Return Order creation and listing
- Claim creation and listing
- GRN creation
- Invoice listing
- Dispatch status
- ARS (Auto Replenishment) settings view
- Business insights
- Inventory batch tracking

## License

Private. All rights reserved.
