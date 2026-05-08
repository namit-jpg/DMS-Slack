export const FEATURE_FLAGS = {
  PRIMARY_ORDER_CREATE: {
    key: 'PRIMARY_ORDER_CREATE',
    default: true,
    dependsOnSalesforce: 'Standard Order create access',
  },
  PRIMARY_ORDER_LIST: {
    key: 'PRIMARY_ORDER_LIST',
    default: true,
    dependsOnSalesforce: 'Standard Order read access',
  },
  SECONDARY_ORDER_CREATE: {
    key: 'SECONDARY_ORDER_CREATE',
    default: true,
    dependsOnSalesforce: 'SecondaryInvoiceController',
  },
  RETURN_ORDER_CREATE: {
    key: 'RETURN_ORDER_CREATE',
    default: true,
    dependsOnSalesforce: 'Return_Order__c create access',
  },
  CLAIM_CREATE: {
    key: 'CLAIM_CREATE',
    default: true,
    dependsOnSalesforce: 'Claim__c create access + ClaimCreatorController',
  },
  GRN_CREATE: {
    key: 'GRN_CREATE',
    default: true,
    dependsOnSalesforce: 'GRN__c create access + GrnController',
  },
  INVOICE_VIEW: {
    key: 'INVOICE_VIEW',
    default: true,
    dependsOnSalesforce: 'RCG_GetInvoicesByAccountNameAPI',
  },
  DISPATCH_VIEW: {
    key: 'DISPATCH_VIEW',
    default: true,
    dependsOnSalesforce: 'Dispatch_Request__c read access',
  },
  ARS_SETTINGS: {
    key: 'ARS_SETTINGS',
    default: true,
    dependsOnSalesforce: 'InventoryReplenishmentController + AutoReplenishmentBatch',
  },
  SCHEME_CALCULATION: {
    key: 'SCHEME_CALCULATION',
    default: true,
    dependsOnSalesforce: 'SchemeCalculationService + RCG_SchemesAPI',
  },
  AI_INSIGHTS: {
    key: 'AI_INSIGHTS',
    default: true,
    dependsOnSalesforce: 'Agent_CreatePrimaryOrderAction + Agent_CheckInventoryAction',
  },
  INVENTORY_VALIDATION: {
    key: 'INVENTORY_VALIDATION',
    default: true,
    dependsOnSalesforce: 'InventoryController + RCG_InventoryAPI',
  },
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export function getDefaultFeatureFlags(): FeatureFlags {
  const flags = {} as FeatureFlags;
  for (const [key, value] of Object.entries(FEATURE_FLAGS)) {
    flags[key as FeatureFlagKey] = value.default;
  }
  return flags;
}

export function isFeatureEnabled(
  flags: FeatureFlags,
  feature: FeatureFlagKey,
): boolean {
  return flags[feature] === true;
}
