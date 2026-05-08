/**
 * Salesforce Capability Audit Script
 *
 * Run: npm run sf:capability-audit
 *
 * This script performs READ-ONLY discovery of existing Salesforce objects,
 * fields, and REST endpoint capabilities. It does NOT create, update, or
 * delete any records. It does NOT deploy metadata.
 *
 * Output: docs/live-salesforce-capability-report.md
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const LOGIN_URL = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';
const CLIENT_ID = process.env.SALESFORCE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET || '';
const USERNAME = process.env.SALESFORCE_USERNAME || '';
const PASSWORD = process.env.SALESFORCE_PASSWORD || '';
const TOKEN = process.env.SALESFORCE_SECURITY_TOKEN || '';
const INSTANCE_URL = process.env.SALESFORCE_INSTANCE_URL || '';
const MOCK_MODE = process.env.USE_MOCK_SALESFORCE === 'true';

const API_VERSION = 'v62.0';

interface AuthResult {
  accessToken: string;
  instanceUrl: string;
}

interface ObjectReport {
  name: string;
  exists: boolean;
  readable: boolean;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  fields: string[];
  keyFieldsFound: string[];
  keyFieldsMissing: string[];
  accountRelationship: string | null;
  status: 'REAL' | 'PARTIAL' | 'MOCK_ONLY' | 'BLOCKED';
  notes: string;
}

interface ApexEndpointReport {
  className: string;
  urlMapping: string | null;
  httpMethod: string | null;
  sourceAvailable: boolean;
  status: 'REAL' | 'UNKNOWN' | 'BLOCKED';
  notes: string;
}

async function auth(): Promise<AuthResult | null> {
  if (MOCK_MODE) {
    console.log('USE_MOCK_SALESFORCE=true — skipping real Salesforce auth');
    return null;
  }

  console.log(`Authenticating to ${LOGIN_URL}...`);
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);
  params.append('username', USERNAME);
  params.append('password', PASSWORD + TOKEN);

  const res = await fetch(`${LOGIN_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Authentication FAILED: ${res.status} — ${body}`);
    return null;
  }

  const data = (await res.json()) as { access_token: string; instance_url: string };
  console.log(`Authenticated OK. Instance: ${data.instance_url}`);
  return { accessToken: data.access_token, instanceUrl: data.instance_url };
}

async function sfGet(auth: AuthResult, path: string): Promise<unknown> {
  const url = path.startsWith('http') ? path : `${auth.instanceUrl}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed: ${res.status} — ${body.substring(0, 200)}`);
  }
  return res.json();
}

async function describeObject(auth: AuthResult, objectName: string): Promise<ObjectReport> {
  const report: ObjectReport = {
    name: objectName,
    exists: false, readable: false, createable: false, updateable: false, deletable: false,
    fields: [], keyFieldsFound: [], keyFieldsMissing: [], accountRelationship: null,
    status: 'BLOCKED', notes: '',
  };

  try {
    const data = await sfGet(auth, `/services/data/${API_VERSION}/sobjects/${objectName}/describe`) as {
      name: string; label: string; fields: Array<{ name: string; type: string; updateable: boolean; createable: boolean; nillable: boolean; referenceTo?: string[]; relationshipName?: string }>;
      createable: boolean; updateable: boolean; deletable: boolean;
    };

    report.exists = true;
    report.readable = true;
    report.createable = data.createable;
    report.updateable = data.updateable;
    report.deletable = data.deletable;
    report.fields = data.fields.map((f) => f.name);

    const keyFields = getKeyFields(objectName);
    for (const kf of keyFields.expected) {
      if (data.fields.some((f) => f.name.toLowerCase() === kf.toLowerCase())) {
        report.keyFieldsFound.push(kf);
      } else {
        report.keyFieldsMissing.push(kf);
      }
    }

    const acctField = data.fields.find((f) =>
      f.referenceTo?.includes('Account') ||
      f.name.toLowerCase().includes('account') ||
      f.name.toLowerCase().includes('distributor') ||
      f.name.toLowerCase().includes('billing'),
    );
    if (acctField) {
      report.accountRelationship = `${acctField.name} (${acctField.type}) → ${acctField.referenceTo?.join(', ') || 'N/A'}`;
    }

    if (report.createable && report.updateable) report.status = 'REAL';
    else if (report.createable || report.updateable) report.status = 'PARTIAL';
    else if (report.exists) report.status = 'REAL';
    else report.status = 'BLOCKED';

    report.notes = `label=${data.label}, createable=${data.createable}, updateable=${data.updateable}, ${data.fields.length} fields`;
  } catch (err) {
    report.notes = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    report.status = 'BLOCKED';
  }

  return report;
}

function getKeyFields(objectName: string): { expected: string[] } {
  const map: Record<string, string[]> = {
    Account: ['Id', 'Name', 'Type', 'IsPartner', 'Email__c', 'Distributor__c', 'Business_Type__c'],
    Contact: ['Id', 'Email', 'FirstName', 'LastName', 'AccountId', 'Distributor__c'],
    Product2: ['Id', 'Name', 'ProductCode', 'IsActive', 'Unit_Of_Measure__c', 'Unit_Price__c'],
    PurchaseOrder__c: ['Id', 'Name', 'Distributor__c', 'Status__c', 'Total_Amount__c', 'Grand_Total__c'],
    Purchase_Order_Item__c: ['Id', 'Order__c', 'Product__c', 'Quantity__c', 'Status__c'],
    GRN__c: ['Id', 'Name', 'Account__c', 'Status__c'],
    Return_Order__c: ['Id', 'Name', 'Account__c', 'Status__c', 'Grand_Total__c'],
    Claim__c: ['Id', 'Name', 'Account__c', 'Claim_Type__c', 'Status__c', 'Amount__c'],
    Invoice__c: ['Id', 'Name', 'Billing_Account__c', 'Status__c', 'Total_Amount__c'],
    Dispatch_Request__c: ['Id', 'Name', 'Order__c', 'Status__c'],
    Inventory_Batch__c: ['Id', 'Product__c', 'Distributor__c', 'Expiry_Date__c', 'Status__c'],
    StoreScheme__c: ['Id', 'Retail_Store__c', 'Status__c', 'Start_Date__c', 'End_Date__c'],
    Scheme_Slab_Target__c: ['Id', 'Promotion__c', 'Discount_Type__c', 'Discount__c'],
    Credit_Note__c: ['Id', 'Name', 'Account__c', 'Status__c', 'Amount__c'],
    ContentVersion: ['Id', 'Title', 'VersionData', 'ContentDocumentId', 'IsMajorVersion'],
    ContentDocumentLink: ['Id', 'ContentDocumentId', 'LinkedEntityId', 'ShareType'],
  };
  return { expected: map[objectName] || ['Id', 'Name'] };
}

async function queryApexClasses(auth: AuthResult, classNames: string[]): Promise<ApexEndpointReport[]> {
  const reports: ApexEndpointReport[] = [];

  for (const name of classNames) {
    const report: ApexEndpointReport = {
      className: name, urlMapping: null, httpMethod: null, sourceAvailable: false, status: 'UNKNOWN', notes: '',
    };

    try {
      const escaped = name.replace(/'/g, "\\'");
      const soql = `SELECT Id, Name, Body FROM ApexClass WHERE Name = '${escaped}' AND NamespacePrefix = null`;
      const q = encodeURIComponent(soql);
      const data = await sfGet(auth, `/services/data/${API_VERSION}/tooling/query/?q=${q}`) as {
        totalSize: number; records: Array<{ Id: string; Name: string; Body?: string }>;
      };

      if (data.totalSize === 0) {
        report.notes = 'Class not found via Tooling API (may be in managed package)';
        report.status = 'BLOCKED';
        reports.push(report);
        continue;
      }

      const rec = data.records[0];
      if (!rec.Body) {
        report.notes = 'Body field empty or not accessible (permissions/managed package)';
        report.status = 'UNKNOWN';
        reports.push(report);
        continue;
      }

      report.sourceAvailable = true;
      const body = rec.Body;

      const urlMatch = body.match(/@RestResource\s*\(\s*urlMapping\s*=\s*'([^']+)'/);
      if (urlMatch) report.urlMapping = urlMatch[1];

      if (body.includes('@HttpGet')) report.httpMethod = 'GET';
      else if (body.includes('@HttpPost')) report.httpMethod = 'POST';
      else if (body.includes('@HttpPatch')) report.httpMethod = 'PATCH';
      else if (body.includes('@HttpPut')) report.httpMethod = 'PUT';

      if (body.includes('@HttpDelete')) report.httpMethod = (report.httpMethod ? report.httpMethod + '+DELETE' : 'DELETE');

      report.notes = `Source available. Methods: ${report.httpMethod || 'None detected'}`;
      report.status = report.urlMapping ? 'REAL' : 'UNKNOWN';
    } catch (err) {
      report.notes = `Query error: ${err instanceof Error ? err.message : String(err)}`;
      report.status = 'BLOCKED';
    }

    reports.push(report);
  }

  return reports;
}

async function checkApprovalApi(auth: AuthResult): Promise<{ available: boolean; notes: string }> {
  try {
    await sfGet(auth, `/services/data/${API_VERSION}/process/approvals`);
    return { available: true, notes: 'Process Approvals REST API is accessible' };
  } catch (err) {
    return { available: false, notes: `Not accessible: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function generateReport(auth: AuthResult | null): Promise<string> {
  const lines: string[] = [];
  const ts = new Date().toISOString();

  lines.push('# Live Salesforce Capability Report');
  lines.push('');
  lines.push(`Generated: ${ts}`);
  lines.push(`SF Instance URL: ${auth?.instanceUrl || (MOCK_MODE ? 'MOCK MODE' : 'NOT AUTHENTICATED')}`);
  lines.push('');

  if (MOCK_MODE || !auth) {
    lines.push('## Audit Skipped');
    lines.push('');
    lines.push('`USE_MOCK_SALESFORCE=true` was set. No real Salesforce connection was made.');
    lines.push('All capabilities are reported as MOCK_ONLY.');
    lines.push('');
    lines.push('Run with `USE_MOCK_SALESFORCE=false` and valid `SALESFORCE_*` env vars for a real audit.');
    return lines.join('\n');
  }

  lines.push('## Object Capabilities');
  lines.push('');
  lines.push('| Object | Exists | Read | Create | Update | Account Link | Key Missing | Status |');
  lines.push('|---|---|---|---|---|---|---|---|');

  const objects = [
    'Account', 'Contact', 'Product2', 'PurchaseOrder__c', 'Purchase_Order_Item__c',
    'GRN__c', 'GRN_Line__c', 'Return_Order__c', 'Return_Order_Line_Item__c',
    'Claim__c', 'Invoice__c', 'Invoice_Line_Item__c', 'Dispatch_Request__c',
    'Inventory_Batch__c', 'StoreScheme__c', 'Scheme_Slab_Target__c', 'Credit_Note__c',
    'ContentVersion', 'ContentDocumentLink',
  ];

  const objectReports: ObjectReport[] = [];
  for (const obj of objects) {
    console.log(`  Describing ${obj}...`);
    const report = await describeObject(auth, obj);
    objectReports.push(report);
    lines.push(`| ${report.name} | ${report.exists ? ':white_check_mark:' : ':x:'} | ${report.readable ? ':white_check_mark:' : ':x:'} | ${report.createable ? ':white_check_mark:' : ':x:'} | ${report.updateable ? ':white_check_mark:' : ':x:'} | ${report.accountRelationship || 'N/A'} | ${report.keyFieldsMissing.join(', ') || 'None'} | ${report.status} |`);
  }

  lines.push('');
  lines.push('## Apex REST Endpoint Discovery');
  lines.push('');

  const apexClasses = [
    'RCG_SchemesAPI', 'RCG_InventoryAPI', 'RCG_PurchaseOrderRestController', 'PurchaseOrderRest',
    'RCG_PurchaseOrderDetailsController', 'RCG_GetAllProductsAPI',
    'RCG_GetOrdersByAccountNameAPI', 'RCG_GetReturnOrdersByAccountNameAPI',
    'RCG_GetInvoicesByAccountNameAPI', 'SecondaryInvoiceCreation',
    'SecondaryOrderBulkInvoiceController', 'ReturnAnalysisController',
    'DistributorCreditController', 'InventoryReplenishmentController',
    'InventoryPolicyController', 'Agent_CheckInventoryAction',
    'Agent_CreatePrimaryOrderAction', 'Agent_GetInventoryPolicies', 'Agent_CreateInventoryPolicies',
  ];

  console.log('Querying Apex classes via Tooling API...');
  const apexReports = await queryApexClasses(auth, apexClasses);

  lines.push('| Class | URL Mapping | HTTP Method | Source Available | Status |');
  lines.push('|---|---|---|---|---|');
  for (const r of apexReports) {
    lines.push(`| ${r.className} | ${r.urlMapping || 'N/A'} | ${r.httpMethod || 'N/A'} | ${r.sourceAvailable ? ':white_check_mark:' : ':x:'} | ${r.status} |`);
  }

  lines.push('');
  lines.push('## Approval API');
  console.log('Checking Process Approvals API...');
  const approvalInfo = await checkApprovalApi(auth);
  lines.push(`- Available: ${approvalInfo.available ? ':white_check_mark: Yes' : ':x: No'}`);
  lines.push(`- Notes: ${approvalInfo.notes}`);

  lines.push('');
  lines.push('## ContentVersion / File Upload');
  const cv = objectReports.find((r) => r.name === 'ContentVersion');
  const cdl = objectReports.find((r) => r.name === 'ContentDocumentLink');
  lines.push(`- ContentVersion: createable=${cv?.createable ?? 'N/A'}, updateable=${cv?.updateable ?? 'N/A'}`);
  lines.push(`- ContentDocumentLink: createable=${cdl?.createable ?? 'N/A'}, updateable=${cdl?.updateable ?? 'N/A'}`);
  lines.push(`- File upload status: ${cv?.createable && cdl?.createable ? 'REAL' : 'BLOCKED'}`);

  lines.push('');
  lines.push('## Summary');
  const realCount = objectReports.filter((r) => r.status === 'REAL').length;
  const partialCount = objectReports.filter((r) => r.status === 'PARTIAL').length;
  const blockedCount = objectReports.filter((r) => r.status === 'BLOCKED').length;
  lines.push(`- Objects: ${objectReports.length} audited`);
  lines.push(`- REAL: ${realCount} | PARTIAL: ${partialCount} | BLOCKED: ${blockedCount}`);
  lines.push(`- Apex endpoints discovered: ${apexReports.filter((r) => r.sourceAvailable).length}/${apexReports.length}`);
  lines.push(`- Approval API: ${approvalInfo.available ? 'Available' : 'Not Available'}`);

  return lines.join('\n');
}

async function main() {
  console.log('=== Salesforce Capability Audit ===');
  console.log(`USE_MOCK_SALESFORCE: ${MOCK_MODE}`);
  console.log('');

  const authResult = await auth();
  const report = await generateReport(authResult);

  const outDir = path.join(__dirname, '..', 'docs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'live-salesforce-capability-report.md');
  fs.writeFileSync(outPath, report, 'utf-8');

  console.log(`\nReport written to: ${outPath}`);
  console.log('=== Audit Complete ===');
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
