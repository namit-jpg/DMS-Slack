# Slack App Setup

## Prerequisites

- Admin access to a Slack workspace
- Ability to install custom apps

## Step-by-Step Setup

### 1. Create Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App"
3. Choose "From scratch"
4. Name your app (e.g., "DMS/SFA Bot")
5. Select your workspace

### 2. Configure HTTP Request Delivery

1. Leave "Socket Mode" disabled.
2. Under **Event Subscriptions**, enable events and set the request URL to the deployed Convex `/slack/events` endpoint.
3. Under **Interactivity & Shortcuts**, set the same deployed Convex `/slack/events` endpoint.
4. Under **Slash Commands**, set the `/dms` request URL to that endpoint.

### 3. Add OAuth Scopes

Go to "OAuth & Permissions" → "Bot Token Scopes" and add:

| Scope | Reason |
|---|---|
| `commands` | Register `/dms` command |
| `chat:write` | Send messages to channels/DMs |
| `users:read` | Resolve user identity |
| `users:read.email` | Get user email for Salesforce mapping |
| `im:write` | Send direct messages (future) |
| `files:read` | Read uploaded files (future) |

### 4. Create Slash Command

1. Go to "Slash Commands"
2. Click "Create New Command"
3. Command: `/dms`
4. Short Description: "Open DMS/SFA dashboard"
5. Usage Hint: (leave blank)
6. Save

### 5. Install App to Workspace

1. Go to "Install App"
2. Click "Install to Workspace"
3. Authorize the requested permissions
4. Copy the "Bot User OAuth Token" (starts with `xoxb-`)
5. Add to `.env` as `SLACK_BOT_TOKEN`

### 6. Get Signing Secret

1. Go to "Basic Information"
2. Under "App Credentials", find "Signing Secret"
3. Copy and add to `.env` as `SLACK_SIGNING_SECRET`
4. This is required for signed HTTP request delivery.

### 7. Event Subscriptions (Optional, for App Home)

1. Go to "Event Subscriptions"
2. Toggle "Enable Events"
3. Add "app_home_opened" event under "Subscribe to bot events"
4. Save

## Verify Configuration

Your `.env` should have:

```env
SLACK_BOT_TOKEN=xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx
SLACK_SIGNING_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SLACK_SOCKET_MODE=false
```

## Testing the Slash Command

1. Start the app: `npm run dev`
2. In Slack, type `/dms`
3. You should see the DMS/SFA dashboard

## Troubleshooting

### Command not appearing
- Ensure the app is installed to the workspace
- Check that the `/dms` slash command is created in the app settings
- Try reinstalling the app

### "dispatch_failed" error
- Confirm the Event Subscriptions, Interactivity, and `/dms` request URLs all target the deployed Convex `/slack/events` endpoint
- Verify `SLACK_SIGNING_SECRET` is set in the deployment secret store
- Check the Convex function logs for the sanitized error code

### "not_authed" error
- Verify `SLACK_BOT_TOKEN` is correct and starts with `xoxb-`
- Ensure the token hasn't been revoked
- Reinstall the app if needed

### Email not resolving
- Ensure `users:read.email` scope is added
- Reinstall the app after adding scopes
- Check that the Slack user has their email visible in their profile

## HTTP Mode for Convex

- Requires the public Convex HTTPS endpoint.
- Verifies every request using the Slack signing secret.
- Uses no App-Level Token and no long-lived Socket Mode connection.
- Keep `SLACK_SOCKET_MODE=false` in any legacy VM configuration during the HTTP cutover.
