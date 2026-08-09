import { defineApp } from 'convex/server';
import { v } from 'convex/values';

/**
 * Deployment contract for the future serverless runtime. Values are declared
 * here for deploy-time validation but are never committed to the repository.
 */
const app = defineApp({
  env: {
    SLACK_BOT_TOKEN: v.string(),
    SLACK_SIGNING_SECRET: v.string(),
    SLACK_TEAM_ID: v.string(),
    // Enterprise Grid interactions can be sent from the installed child
    // workspace without `enterprise_id`; this stays a one-workspace allowlist.
    SLACK_WORKSPACE_ID: v.optional(v.string()),
    SLACK_COMMAND: v.literal('/dms'),
    SLACK_SALES_CHANNEL_ID: v.optional(v.string()),
    SALESFORCE_AUTH_MODE: v.literal('CLIENT_CREDENTIALS'),
    SALESFORCE_LOGIN_URL: v.string(),
    SALESFORCE_CLIENT_ID: v.string(),
    SALESFORCE_CLIENT_SECRET: v.string(),
    ALLOW_SAFE_SALESFORCE_TEST_WRITES: v.union(v.literal('false'), v.literal('true')),
    // The deployment starts with this set to "false". Enabling it is a
    // separate cutover action after the read-only rehearsal is accepted.
    ALLOW_LIVE_BUSINESS_WRITES_FROM_SLACK: v.union(v.literal('false'), v.literal('true')),
    LOG_LEVEL: v.optional(v.union(v.literal('debug'), v.literal('info'), v.literal('warn'), v.literal('error'))),
  },
});

export default app;
