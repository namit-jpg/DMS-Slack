/**
 * Salesforce CLI Auth Verification & Identity Check
 *
 * Run: npm run sf:cli-auth-check
 */

import 'dotenv/config';
import { execSync } from 'child_process';

const MOCK_MODE = process.env.USE_MOCK_SALESFORCE === 'true';
const LIVE_EMAIL = process.env.LIVE_TEST_EMAIL || 'namit@warpdrivetech.in';
const TARGET = process.env.SALESFORCE_CLI_TARGET_ORG || '';
const rawApiVersion = (process.env.SALESFORCE_API_VERSION || '66.0').replace(/^v/i, '');
const API_VERSION = rawApiVersion.includes('.') ? rawApiVersion : `${rawApiVersion}.0`;

function run(cmd: string): string { return execSync(cmd, { encoding: 'utf-8', timeout: 15000 }); }

async function sfRest(token: string, instanceUrl: string, path: string): Promise<any> {
  const url = `${instanceUrl}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sfQuery(token: string, instanceUrl: string, soql: string): Promise<any> {
  return sfRest(token, instanceUrl, `/services/data/v${API_VERSION}/query/?q=${encodeURIComponent(soql)}`);
}

async function main() {
  console.log('=== Salesforce CLI Auth Check ===');
  console.log(`USE_MOCK_SALESFORCE: ${MOCK_MODE}`);
  console.log('');

  if (MOCK_MODE) {
    console.log('[SKIP] USE_MOCK_SALESFORCE=true - no Salesforce connection needed');
    process.exit(0);
  }

  let orgInfo: any = null;

  try {
    const raw = run(`sf org list auth --json`);
    const data = JSON.parse(raw);
    const orgs = data.result || [];
    console.log(`Found ${orgs.length} authenticated orgs:`);
    for (const org of orgs) {
      console.log(`  ${org.username} (alias: ${org.alias || 'none'}) - ${org.instanceUrl}`);
    }

    let match = null;
    if (TARGET) {
      console.log(`\nUsing SALESFORCE_CLI_TARGET_ORG: ${TARGET}`);
      const rawDisp = run(`sf org display --target-org ${TARGET} --json`);
      const disp = JSON.parse(rawDisp);
      orgInfo = disp.result;
      // re-run list auth to get the token
      const matchingOrg = orgs.find((o: any) => o.username === disp.result.username || o.alias === TARGET);
      if (matchingOrg) orgInfo.accessToken = matchingOrg.accessToken;
      orgInfo.orgId = disp.result.orgId || disp.result.id || matchingOrg?.orgId;
    } else {
      const keywords = ['rcg', 'dms', 'sfa', 'warpdrive', 'wd.in'];
      match = orgs.find((o: any) => keywords.some((k: string) => (o.alias || '').toLowerCase().includes(k) || (o.username || '').toLowerCase().includes(k)));
      if (!match) match = orgs[0];
      if (match) {
        const rawDisp = run(`sf org display --target-org ${match.username} --json`);
        const disp = JSON.parse(rawDisp);
        orgInfo = { ...disp.result, accessToken: match.accessToken };
        orgInfo.orgId = disp.result.id || disp.result.orgId;
      }
    }

    if (!orgInfo) {
      console.log('[FAIL] Could not resolve a Salesforce org. Set SALESFORCE_CLI_TARGET_ORG.');
      process.exit(1);
    }

    const maskedAccessToken = orgInfo.accessToken ? orgInfo.accessToken.substring(0, 8) + '...' : 'N/A';
    console.log('[PASS] Salesforce CLI auth successful');
    console.log(`  Username: ${orgInfo.username}`);
    console.log(`  Org ID: ${orgInfo.orgId}`);
    console.log(`  Instance URL: ${orgInfo.instanceUrl}`);
    console.log(`  Access token: ${maskedAccessToken}`);

    console.log('\nVerifying REST API access...');
    const orgData = await sfQuery(orgInfo.accessToken, orgInfo.instanceUrl, 'SELECT Id, Name FROM Organization LIMIT 1');
    console.log('[PASS] REST API query successful');

    console.log(`\nVerifying identity mapping for: ${LIVE_EMAIL}`);
    const emailEscaped = LIVE_EMAIL.replace(/'/g, "\\'");

    try {
      const contactData = await sfQuery(orgInfo.accessToken, orgInfo.instanceUrl, `SELECT Id, Email, Distributor__c FROM Contact WHERE Email = '${emailEscaped}' LIMIT 1`);
      if (contactData.records.length > 0) {
        const c = contactData.records[0];
        console.log(`[PASS] Contact found: ${c.Id} (Distributor__c: ${c.Distributor__c || 'null'})`);
        if (c.Distributor__c) {
          const acctData = await sfQuery(orgInfo.accessToken, orgInfo.instanceUrl, `SELECT Id, Name, Type, Business_Type__c, IsPartner FROM Account WHERE Id = '${c.Distributor__c}' LIMIT 1`);
          if (acctData.records.length > 0) {
            const a = acctData.records[0];
            console.log(`[PASS] Distributor Account: ${a.Name} (${a.Id})`);
            console.log(`  Type: ${a.Type} | IsPartner: ${a.IsPartner} | Business: ${a.Business_Type__c || 'N/A'}`);
          } else {
            console.log('[FAIL] Distributor Account referenced by Contact not found');
          }
        }
      } else {
        console.log('Contact not found by email. Trying Account.Email__c...');
        const acctData = await sfQuery(orgInfo.accessToken, orgInfo.instanceUrl, `SELECT Id, Name, Type, Business_Type__c, IsPartner FROM Account WHERE Email__c = '${emailEscaped}' AND IsPartner = true LIMIT 1`);
        if (acctData.records.length > 0) {
          const a = acctData.records[0];
          console.log(`[PASS] Distributor Account (via Email__c): ${a.Name} (${a.Id})`);
        } else {
          console.log('[FAIL] No Contact or Account found for this email');
        }
      }
    } catch (err: any) {
      console.log(`[FAIL] Identity check error: ${err.message}`);
    }
  } catch (err: any) {
    console.log(`[FAIL] ${err.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
