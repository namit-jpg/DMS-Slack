export interface SalesforceBlocker {
  id: string;
  feature: string;
  reason: string;
  workaround?: string;
  suggestedSalesforceChange: string;
}

export const BLOCKERS: SalesforceBlocker[] = [
  {
    id: 'BLK-001',
    feature: 'Scheme/Offer Calculation',
    reason:
      'SchemeCalculationService exists as Apex but its REST endpoint path is unknown. ' +
      'Without the exact endpoint URL and request format, we cannot call scheme calculation from Slack.',
    workaround:
      'Use standard Order record creation and org-side automation where available. If scheme fields are ' +
      'automatically computed on insert, this gap is partially mitigated.',
    suggestedSalesforceChange:
      'Document the RCG_SchemesAPI REST endpoint contract (URL path, HTTP method, request/response format).',
  },
  {
    id: 'BLK-002',
    feature: 'Pricing Calculation',
    reason:
      'Pricing logic exists in Apex classes (SchemeCalculationService, B2BPricingSample) ' +
      'but may not be exposed as REST endpoints. Pricing may be computed automatically ' +
      'when standard Order records are created via triggers.',
    workaround:
      'Create standard Order records via REST API and verify if pricing fields ' +
      'are auto-populated by existing Apex triggers. If not, pricing is limited to static prices from Product2.',
    suggestedSalesforceChange:
      'Document whether pricing is auto-calculated on standard Order record creation, ' +
      'or expose a REST endpoint for pricing calculation.',
  },
  {
    id: 'BLK-003',
    feature: 'Inventory Validation at Order Time',
    reason:
      'Inventory is managed via Inventory_Batch__c and several Apex controllers ' +
      '(InventoryController, RCG_InventoryAPI). Live inventory validation at order time ' +
      'requires calling these APIs which may not have documented endpoints.',
    workaround:
      'Read inventory via query on Inventory_Batch__c. Validate stock quantities client-side ' +
      'before creating orders. This is less robust than server-side validation.',
    suggestedSalesforceChange:
      'Document RCG_InventoryAPI REST endpoint contract for inventory checks.',
  },
  {
    id: 'BLK-004',
    feature: 'Partial Invoice Logic',
    reason:
      'PartialInvoiceReminderScheduler exists but the partial invoice creation logic is in Apex ' +
      'classes (SecondaryInvoiceController, SecondaryInvoiceCreation). The REST endpoint paths are unknown.',
    workaround:
      'Use a mock implementation. Mark the real Salesforce implementation as blocked.',
    suggestedSalesforceChange:
      'Document SecondaryInvoiceCreation and SecondaryInvoiceController REST endpoint contracts.',
  },
  {
    id: 'BLK-005',
    feature: 'Approval Workflow',
    reason:
      'Approval processes for orders exist in Salesforce but are triggered through Apex ' +
      'and configured via declarative tools. The Slack app cannot directly participate in approvals.',
    workaround:
      'Show approval status as read-only in Slack. Approval actions remain in Salesforce UI.',
    suggestedSalesforceChange:
      'Expose approval actions (approve/reject) via REST endpoints if Slack-based approvals are needed.',
  },
  {
    id: 'BLK-006',
    feature: 'Return Order Creation with Auto-Calculation',
    reason:
      'Return_Order__c creation, return analysis (ReturnAnalysisController), and auto ' +
      'scheme reversal logic exist in Apex but REST endpoint paths are unknown.',
    workaround:
      'Create Return_Order__c records via standard REST API. If scheme reversal and ' +
      'return analysis triggers fire on insert, values auto-populate. Otherwise, these must be computed client-side.',
    suggestedSalesforceChange:
      'Document ReturnAnalysisController REST endpoint contract for return calculations.',
  },
  {
    id: 'BLK-007',
    feature: 'Credit Note Generation',
    reason:
      'Credit_Note__c and Credit_Note_Usage__c objects exist but there is no visible ' +
      'REST endpoint for credit note generation. The logic is likely in Apex triggers or flows.',
    workaround:
      'Create Credit_Note__c records via standard REST API. If auto-generation logic exists ' +
      'as triggers, the credit note will be created automatically.',
    suggestedSalesforceChange:
      'Document credit note generation flow and any REST endpoints for programmatic credit note creation.',
  },
  {
    id: 'BLK-008',
    feature: 'ARS Logic (Auto Replenishment)',
    reason:
      'AutoReplenishmentBatch, AutoReplenishmentScheduler, and InventoryReplenishmentController exist ' +
      'but the REST endpoint contracts and behavior may not align with Slack-based triggers.',
    workaround:
      'Read inventory data via query. Display stock levels and allow manual reorder from Slack. ' +
      'The auto-replenishment batch runs on its own schedule in Salesforce.',
    suggestedSalesforceChange:
      'Document InventoryReplenishmentController REST endpoint contract.',
  },
  {
    id: 'BLK-009',
    feature: 'AI Insights',
    reason:
      'Agent_CheckInventoryAction and Agent_CreatePrimaryOrderAction exist in Apex but their ' +
      'invocation mechanism (Agentforce / Einstein) is not accessible via standard REST API.',
    workaround:
      'Compute basic insights client-side based on order history and inventory data. ' +
      'This is a simplified proxy for true AI-driven insights.',
    suggestedSalesforceChange:
      'Document how AI Agent actions can be invoked via REST or if they are limited to Agentforce UI.',
  },
  {
    id: 'BLK-010',
    feature: 'Distributor Email Mapping',
    reason:
      'SFA_User__c has email__c but no direct Account lookup. The mapping between ' +
      'Slack user email and the Distributor Account may need to go through Contact.Email → Contact.Distributor__c ' +
      'or Account.Email__c directly.',
    workaround:
      'Implement a two-step resolution: (1) find Contact by email → get Distributor__c, (2) find Account by Email__c, ' +
      '(3) also search SFA_User__c by email__c for validation. Use whichever path resolves first.',
    suggestedSalesforceChange:
      'Add a Distributor__c (Account lookup) field to SFA_User__c for direct email-to-Account mapping.',
  },
  {
    id: 'BLK-011',
    feature: 'SFA Mobile REST API Reuse',
    reason:
      'SFAMobileRESTAPI and SFA AuthenticateAPI exist but are designed for SFA mobile app users. ' +
      'These endpoints likely use SFA_User__c authentication (password__c + OTP) rather than ' +
      'Salesforce OAuth. The Slack app uses a single Salesforce integration user, which ' +
      'cannot use per-user SFA authentication.',
    workaround:
      'Do not use SFA mobile REST APIs directly. Instead, use standard Salesforce REST API ' +
      'with the integration user token. Query/CRUD the same objects the mobile app uses.',
    suggestedSalesforceChange:
      'Document whether SFAMobileRESTAPI accepts Salesforce session tokens (Bearer auth) ' +
      'in addition to SFA user credentials.',
  },
  {
    id: 'BLK-012',
    feature: 'REST Endpoint URL Discovery',
    reason:
      'Apex @RestResource URL mappings cannot be discovered via Tooling API alone. ' +
      'The exact URL path for each RCG REST endpoint is unknown without reading Apex class bodies.',
    workaround:
      'For now all RCG REST endpoints are documented as blocked. The Slack app uses ' +
      'standard Salesforce REST API (query, create, update, delete) which is always available.',
    suggestedSalesforceChange:
      'Provide a list of available RCG REST endpoints with URL paths, HTTP methods, and request/response schemas.',
  },
];

export function getBlocker(id: string): SalesforceBlocker | undefined {
  return BLOCKERS.find((b) => b.id === id);
}

export function getBlockersByFeature(feature: string): SalesforceBlocker[] {
  return BLOCKERS.filter((b) =>
    b.feature.toLowerCase().includes(feature.toLowerCase()),
  );
}

export function getUnblockedFeatures(): string[] {
  return BLOCKERS.filter((b) => b.workaround).map((b) => b.feature);
}

export function getFullyBlockedFeatures(): string[] {
  return BLOCKERS.filter((b) => !b.workaround).map((b) => b.feature);
}
