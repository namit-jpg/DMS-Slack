# Slack CLI Live Setup

## Current Status

### Slack CLI
- Version: `slack.exe v3.10.0`
- Status: Authenticated
- Authenticated workspaces:
  - `warpdrivegridsandbox` (E095QSY1H8R) — Organization level
  - `warpdrivetech` (TN91WT8TU) — Workspace level

### Slack Project
- Initialized in current directory (`.slack/` created)
- App configuration: `manifest.json` available

## Setup via Slack UI (Primary Path — Enterprise Grid)

Enterprise Grid workspaces require admin approval for app installation.

### Step 1: Create the App

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From a manifest"
3. Select the workspace: **WD RCG DMS SFA** (Enterprise Grid)
4. Paste the content of `manifest.json` from this repository
5. Click "Create"
6. Confirm the app details

### Step 2: Configure HTTP Request Delivery

1. Leave Socket Mode disabled.
2. Configure the deployed Convex `/slack/events` URL under Event Subscriptions, Interactivity & Shortcuts, and the `/dms` slash command.
3. Keep the Slack signing secret in the Convex deployment secret store.

### Step 3: Install to Workspace

1. Go to "Install App" → "Install to Workspace"
2. Authorize the app
3. Copy the "Bot User OAuth Token" (starts with `xoxb-`)
4. Add to `.env`: `SLACK_BOT_TOKEN=xoxb-...`

### Step 4: Enable Events

1. Go to "Event Subscriptions"
2. Subscribe to `app_home_opened` bot event

### Step 5: Create Slash Command

1. Go to "Slash Commands"
2. Create `/dms` command

### Step 6: Link with Slack CLI (Optional)

```bash
# After creating the app in the Slack UI, link it:
slack app link

# This will prompt you to select the app you just created
```

### Step 7: Install using Slack CLI (Optional)

```bash
# After linking, install to a workspace:
slack app install --team warpdrivegridsandbox
```

## Enterprise Grid Approval

If the workspace is Enterprise Grid:
1. The app may need admin approval before it can be installed
2. An admin from the organization needs to approve the app
3. After approval, run: `slack app install --team warpdrivegridsandbox`

## Environment Variables

After setup, your `.env` should contain:

```env
USE_MOCK_SALESFORCE=false
SALESFORCE_AUTH_MODE=SF_CLI
SLACK_SOCKET_MODE=false
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=xxxxxxxx...
LIVE_TEST_EMAIL=namit@warpdrivetech.in
```

## Verification

```bash
# Check live readiness
npm run live:check

# Verify Salesforce CLI auth + identity mapping
npm run sf:cli-auth-check

# Run smoke test
npm run live:smoke

# Start the app in live mode
npm run live:dev
```

## Testing in Slack

After installation, in the **WD RCG DMS SFA** workspace:

1. Type `/dms` — should show the dashboard
2. The diagnostics button will show:
   - Salesforce Mode: REAL
   - Auth Mode: SF_CLI
   - Resolved Account
   - Feature statuses

## Troubleshooting

### "dispatch_failed" error
- Check that Socket Mode is disabled and every Slack request URL targets the deployed Convex `/slack/events` endpoint
- Verify `SLACK_APP_TOKEN` is correct

### "not_authed" error
- Verify `SLACK_BOT_TOKEN` is correct
- Reinstall the app to refresh the token

### Identity not resolving
- Run `npm run sf:cli-auth-check` to verify email → Account mapping
- Check that `namit@warpdrivetech.in` exists as a Contact with `Distributor__c` set

### Enterprise Grid approval pending
- Contact an Org Admin to approve the app
- App will show as "Pending Approval" in the Slack App Directory
