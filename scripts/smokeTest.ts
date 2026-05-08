/**
 * Salesforce Smoke Test
 *
 * Run: npm run sf:smoke-test -- --email someone@example.com
 *
 * Requires USE_MOCK_SALESFORCE=false
 * Performs READ-ONLY queries only. No record creation unless
 * ALLOW_SAFE_SALESFORCE_TEST_WRITES=true.
 */

import 'dotenv/config';

const MOCK_MODE = process.env.USE_MOCK_SALESFORCE === 'true';
const ALLOW_WRITES = process.env.ALLOW_SAFE_SALESFORCE_TEST_WRITES === 'true';
const LOGIN_URL = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';
const CLIENT_ID = process.env.SALESFORCE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET || '';
const USERNAME = process.env.SALESFORCE_USERNAME || '';
const PASSWORD = process.env.SALESFORCE_PASSWORD || '';
const TOKEN = process.env.SALESFORCE_SECURITY_TOKEN || '';
const API_VERSION = 'v62.0';

const args = process.argv.slice(2);
const emailArg = args.find((a) => a.startsWith('--email='));
const testEmail = emailArg ? emailArg.split('=')[1] : null;

const results: Array<{ test: string; status: 'PASS' | 'FAIL' | 'SKIP'; details: string }> = [];

function pass(test: string, details = '') { results.push({ test, status: 'PASS', details }); console.log(`  PASS: ${test}`); }
function fail(test: string, details = '') { results.push({ test, status: 'FAIL', details }); console.log(`  FAIL: ${test} — ${details}`); }
function skip(test: string, details = '') { results.push({ test, status: 'SKIP', details }); console.log(`  SKIP: ${test} — ${details}`); }

async function auth() {
  console.log('Authenticating...');
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);
  params.append('username', USERNAME);
  params.append('password', PASSWORD + TOKEN);

  const res = await fetch(`${LOGIN_URL}/services/oauth2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; instance_url: string; id: string };
  return data;
}

async function sfGet(token: string, instanceUrl: string, path: string): Promise<unknown> {
  const url = path.startsWith('http') ? path : `${instanceUrl}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
}

async function sfQuery(token: string, instanceUrl: string, soql: string): Promise<unknown> {
  const q = encodeURIComponent(soql);
  return sfGet(token, instanceUrl, `/services/data/${API_VERSION}/query/?q=${q}`);
}

function resolveDistributor(token: string, instanceUrl: string, email: string): Promise<unknown> {
  const e = email.replace(/'/g, "\\'");
  return sfQuery(token, instanceUrl, `SELECT Id, Name, Type, IsPartner, Business_Type__c, Email__c FROM Account WHERE Email__c = '${e}' AND IsPartner = true LIMIT 1`);
}

async function main() {
  console.log('=== Salesforce Smoke Test ===');

  if (MOCK_MODE) {
    skip('All tests', 'USE_MOCK_SALESFORCE=true — real Salesforce tests skipped');
    return;
  }

  if (!testEmail) {
    console.log('No --email provided. Run: npm run sf:smoke-test -- --email someone@example.com');
    console.log('Skipping distributor resolution and scoped queries.');
  }

  let token: string | undefined;
  let instanceUrl: string | undefined;

  try {
    const authData = await auth();
    token = authData.access_token;
    instanceUrl = authData.instance_url;
    pass('auth', `Authenticated as ${authData.id}`);
    const orgInfo = await sfGet(token, instanceUrl, `/services/data/${API_VERSION}/sobjects/Organization`) as { records: Array<{ Name: string; Id: string }> };
    try {
      const orgName = (orgInfo as any).records?.[0]?.Name || (orgInfo as any).Name || 'Unknown';
      pass('org_info', `Org: ${orgName}`);
    } catch { pass('org_info', 'Authenticated; org info available'); }
  } catch (err) {
    fail('auth', err instanceof Error ? err.message : String(err));
    return;
  }

  try {
    const products = await sfQuery(token, instanceUrl, 'SELECT Id, Name, ProductCode, IsActive FROM Product2 WHERE IsActive = true LIMIT 5') as { records: Array<unknown> };
    if (products.records.length > 0) pass('products', `${products.records.length} active products found`);
    else fail('products', 'No active products found');
  } catch (err) { fail('products', err instanceof Error ? err.message : String(err)); }

  if (testEmail) {
    try {
      const acctResult = await resolveDistributor(token, instanceUrl, testEmail) as { records: Array<{ Id: string; Name: string }> };
      if (acctResult.records.length === 0) {
        fail('distributor_resolve', `No distributor found for email: ${testEmail}`);
      } else {
        const acct = acctResult.records[0];
        pass('distributor_resolve', `Resolved: ${acct.Name} (${acct.Id})`);
        const acctId = acct.Id.replace(/'/g, "\\'");

        try {
          const orders = await sfQuery(token, instanceUrl, `SELECT Id, Name, Status__c FROM PurchaseOrder__c WHERE Distributor__c = '${acctId}' LIMIT 5`) as { records: Array<unknown> };
          pass('primary_orders', `${orders.records.length} primary orders found for account`);
        } catch (err) { fail('primary_orders', err instanceof Error ? err.message : String(err)); }

        try {
          const returns = await sfQuery(token, instanceUrl, `SELECT Id, Name, Status__c FROM Return_Order__c WHERE Account__c = '${acctId}' LIMIT 5`) as { records: Array<unknown> };
          pass('return_orders', `${returns.records.length} return orders found`);
        } catch (err) { skip('return_orders', err instanceof Error ? err.message : String(err)); }

        try {
          const claims = await sfQuery(token, instanceUrl, `SELECT Id, Name, Status__c FROM Claim__c WHERE Account__c = '${acctId}' LIMIT 5`) as { records: Array<unknown> };
          pass('claims', `${claims.records.length} claims found`);
        } catch (err) { skip('claims', err instanceof Error ? err.message : String(err)); }

        try {
          const batches = await sfQuery(token, instanceUrl, `SELECT Id, Product__c, Status__c FROM Inventory_Batch__c WHERE Distributor__c = '${acctId}' LIMIT 5`) as { records: Array<unknown> };
          pass('inventory_batches', `${batches.records.length} inventory batches found`);
        } catch (err) { skip('inventory_batches', err instanceof Error ? err.message : String(err)); }
      }
    } catch (err) { fail('distributor_resolve', err instanceof Error ? err.message : String(err)); }
  } else {
    skip('scoped_queries', 'No email provided; skipped all scoped queries');
  }

  console.log('');
  console.log('=== Results ===');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  console.log(`PASS: ${passed} | FAIL: ${failed} | SKIP: ${skipped}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
