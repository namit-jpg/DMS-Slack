/**
 * Live Mode Readiness Check
 * Run: npm run live:check
 */

import 'dotenv/config';

const checks: Array<{ label: string; status: 'PASS' | 'FAIL' | 'WARN'; detail: string }> = [];

function pass(label: string, detail = '') { checks.push({ label, status: 'PASS', detail }); }
function fail(label: string, detail = '') { checks.push({ label, status: 'FAIL', detail }); }
function warn(label: string, detail = '') { checks.push({ label, status: 'WARN', detail }); }

async function main() {
  console.log('=== Live Mode Readiness Check ===\n');

  // 1. USE_MOCK_SALESFORCE
  if (process.env.USE_MOCK_SALESFORCE === 'false') pass('USE_MOCK_SALESFORCE=false', 'App will use real Salesforce');
  else fail('USE_MOCK_SALESFORCE', `Currently set to "${process.env.USE_MOCK_SALESFORCE || 'true'}" - must be "false" for live mode`);

  // 2. Salesforce auth
  const sfMode = process.env.SALESFORCE_AUTH_MODE || '';
  pass('SALESFORCE_AUTH_MODE', sfMode || 'SF_CLI');
  if (sfMode === 'SF_CLI' || !sfMode) {
    try {
      const { execSync } = require('child_process');
      const raw = execSync('sf org list auth --json', { encoding: 'utf-8', timeout: 10000 });
      const data = JSON.parse(raw);
      if (data.result?.length > 0) pass('Salesforce CLI orgs', `${data.result.length} authenticated`);
      else fail('Salesforce CLI orgs', 'No authenticated orgs found');
    } catch (err: any) { fail('Salesforce CLI', err.message); }
  }

  // 3. Live test email
  const email = process.env.LIVE_TEST_EMAIL || '';
  if (email) pass('LIVE_TEST_EMAIL', email);
  else warn('LIVE_TEST_EMAIL', 'Not set - identity resolution tests will be skipped');

  // 4. Slack env vars
  const botToken = process.env.SLACK_BOT_TOKEN || '';
  const appToken = process.env.SLACK_APP_TOKEN || '';
  const signingSecret = process.env.SLACK_SIGNING_SECRET || '';
  if (botToken) pass('SLACK_BOT_TOKEN', `Set (${botToken.substring(0, 10)}...)`);
  else warn('SLACK_BOT_TOKEN', 'Not set');

  if (appToken) pass('SLACK_APP_TOKEN', `Set (${appToken.substring(0, 10)}...)`);
  else warn('SLACK_APP_TOKEN', 'Not set');

  if (signingSecret) pass('SLACK_SIGNING_SECRET', 'Set');
  else warn('SLACK_SIGNING_SECRET', 'Not set');

  // 5. Slack CLI
  try {
    const { execSync } = require('child_process');
    const raw = execSync('slack auth list', { encoding: 'utf-8', timeout: 10000 });
    if (raw.includes('Team ID:')) pass('Slack CLI auth', 'Authenticated');
    else warn('Slack CLI auth', 'Not authenticated');
  } catch { warn('Slack CLI', 'Not available or not authenticated'); }

  // 6. Safety
  if (process.env.ALLOW_LIVE_BUSINESS_WRITES_FROM_SLACK === 'true') warn('Live writes', 'ALLOW_LIVE_BUSINESS_WRITES_FROM_SLACK=true - Slack actions will create real Salesforce records');
  else pass('Safe write mode', 'No writes enabled');

  // Print
  console.log('\n=== Results ===');
  for (const c of checks) {
    const icon = c.status === 'PASS' ? '[PASS]' : c.status === 'FAIL' ? '[FAIL]' : '[WARN]';
    console.log(`${icon} ${c.label}: ${c.detail}`);
  }

  const fails = checks.filter((c) => c.status === 'FAIL');
  console.log(`\nPASS: ${checks.filter((c) => c.status === 'PASS').length} | FAIL: ${fails.length} | WARN: ${checks.filter((c) => c.status === 'WARN').length}`);
  if (fails.length > 0) process.exit(1);
}

main().catch(console.error);
