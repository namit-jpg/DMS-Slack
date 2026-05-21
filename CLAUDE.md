# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # Start in mock mode (tsx watch, no build needed)
npm test              # Run all vitest tests (vitest run)
npm run test:watch    # vitest in watch mode
npm run lint          # ESLint on src/
npm run typecheck     # tsc --noEmit
npm run build         # tsc (emits to dist/)
npm start             # Production: prestart → build → node dist/server.js
```

**Order**: `lint → typecheck → test` before committing. `build` only for production/VM deploy.

**Run a single test file**: `npx vitest run src/tests/mvp.test.ts`

## Mock vs Live mode

- **Mock (default)**: `npm run dev` — no Salesforce needed. All Slack flows work with seeded data.
- **Live**: `$env:USE_MOCK_SALESFORCE='false'; $env:SALESFORCE_AUTH_MODE='SF_CLI'; npm.cmd start`
  - Use `npm.cmd start` (not `npm run dev`) — live mode uses `prestart → build → node dist/`.
  - The `live:dev` script exists but may not always work on Windows due to `set` syntax.
  - SF CLI auth requires `sf org list auth` returning `rcg-dms` alias; token lives in `~/.sfdx/`.

## Architecture essentials

- **Dual HTTP listener + Slack Socket Mode** (default): A raw `http.createServer` on `PORT` (3000) serves the health endpoint. The `@slack/bolt` App connects via Socket Mode on the same process. In HTTP mode, Bolt listens on `PORT+1` (3001).
- **Entry point**: `src/server.ts` → initializes SF client → `createApp()` → starts health server + Bolt app + reminder/poller services.
- **Config**: All env validated via Zod in `src/config/env.ts`. Use `env.*` (not `process.env.*`) everywhere — the Zod schema has typed defaults.
- **Salesforce client**: Two-mode factory in `src/salesforce/SalesforceClient.ts`. `getSalesforceClient()` is **sync** for mock; `initSalesforceClient()` is **async** for real. Always import the initializer from there, never instantiate clients directly.
- **Identity pipeline**: Every Slack action resolves `{ identity, context }` via `IdentityPipeline.resolve(slackUserId)`. The `context` (`ResolvedDistributorContext`) carries `salesforceAccountId` — all service calls use this for data scoping. Handle errors with `pipeline.resolveUserFacingMessage(err)` for user-safe messages.

## Conventions

- **Error handling**: Use the custom error classes in `src/utils/errors.ts` — `AppError`, `SlackUserError`, `SalesforceError`, `IdentityResolutionError`, etc. All carry a `userMessage` for Slack display.
- **Result monad**: `src/utils/result.ts` — `{ success: true, data } | { success: false, error }`. Services return `Result<T, E>`. Use `isSuccess()`/`isFailure()` guards, never `unwrap()` in production paths.
- **Logging**: Pino via `src/utils/logger.ts`. Use `createChildLogger('ComponentName')` for scoped loggers. Pass objects as first arg: `logger.info({ key: val }, 'message')`.
- **Idempotency**: `src/persistence/idempotencyStore.ts` — in-memory only. Lost on restart.
- **Slack constants**: All callback IDs, action IDs, block IDs, and view IDs are centralized in `src/config/slackConstants.ts` with derived union types. Always add new IDs there.
- **Feature flags**: Defined in `src/config/featureFlags.ts`. Check with `isFeatureEnabled(flags, key)` before gating behavior.
- **Block builders**: UI rendering lives in `src/slack/blocks/`. Never inline large Block Kit payloads in action handlers.
- **Modals**: Defined in `src/slack/modals/` (separate from block builders). Use `app.client.views.open()` for true modals, `safeRespond()` for ephemeral views.

## Critical constraints

- **NO Salesforce-side changes**: This app uses existing Salesforce objects/APIs as-is. Gaps are documented blockers in `src/salesforce/blockers.ts` and `docs/salesforce-gaps-and-blockers.md`. When a feature can't work in real mode, throw `BlockedBySalesforceCapabilityError`.
- **App-enforced authorization**: One SF integration user, many Slack users. The app must scope all queries/creates by `salesforceAccountId` from the resolved context. No Salesforce sharing rules for defense-in-depth.
- **In-memory stores**: State and idempotency are in-memory Maps. No persistence. Acceptable for current scale.

## Test conventions

- Tests in `src/tests/**/*.test.ts` (excluded from `tsconfig.json` compile, but run by vitest).
- Use `MockSalesforceClient` for tests — no Salesforce connection needed.
- Pattern: `makeContext(overrides)` factory for `ResolvedDistributorContext`.
- Run with `vitest` (not Jest).

## Deployment

- Production on GCP Compute Engine (`dmsfa-server`, `us-central1-a`). Managed via pm2.
- Full ritual in `docs/deployment-ritual.md`.
- SF CLI auth must be present under `/root/.sfdx/` on the VM.
- ngrok for Slack HTTP endpoint when not using Socket Mode.
