export const SLACK_COMMANDS = {
  DMS: '/dms',
} as const;

export const SLACK_CALLBACK_IDS = {
  DMS_MAIN_MENU: 'dms_main_menu',
  CREATE_PRIMARY_ORDER: 'dms_create_primary_order',
  MY_PRIMARY_ORDERS: 'dms_my_primary_orders',
  SECONDARY_ORDERS: 'dms_secondary_orders',
  RETURNS_AND_CLAIMS: 'dms_returns_and_claims',
  ARS_SETTINGS: 'dms_ars_settings',
  BUSINESS_INSIGHTS: 'dms_business_insights',
  PRIMARY_ORDER_MODAL: 'dms_primary_order_modal',
  RETURN_ORDER_MODAL: 'dms_return_order_modal',
  CLAIM_MODAL: 'dms_claim_modal',
  GRN_MODAL: 'dms_grn_modal',
  SECONDARY_ORDER_MODAL: 'dms_secondary_order_modal',
  INVOICE_MODAL: 'dms_invoice_modal',
  DISPATCH_MODAL: 'dms_dispatch_modal',
  ARS_MODAL: 'dms_ars_modal',
} as const;

export const SLACK_ACTION_IDS = {
  SELECT_ORDER_TYPE: 'select_order_type',
  SELECT_PRODUCT: 'select_product',
  SELECT_QUANTITY: 'select_quantity',
  SELECT_RETURN_REASON: 'select_return_reason',
  SELECT_CLAIM_TYPE: 'select_claim_type',
  SELECT_GRN_ITEMS: 'select_grn_items',
  SELECT_INVOICE: 'select_invoice',
  SELECT_DISPATCH: 'select_dispatch',
  SUBMIT_PRIMARY_ORDER: 'submit_primary_order',
  SUBMIT_RETURN_ORDER: 'submit_return_order',
  SUBMIT_CLAIM: 'submit_claim',
  SUBMIT_GRN: 'submit_grn',
  SUBMIT_SECONDARY_ORDER: 'submit_secondary_order',
  SUBMIT_INVOICE: 'submit_invoice',
  SUBMIT_DISPATCH: 'submit_dispatch',
  VIEW_ORDER_DETAIL: 'view_order_detail',
  VIEW_RETURN_DETAIL: 'view_return_detail',
  VIEW_CLAIM_DETAIL: 'view_claim_detail',
  VIEW_INVOICE_DETAIL: 'view_invoice_detail',
  CANCEL_ACTION: 'cancel_action',
  BACK_TO_MENU: 'back_to_menu',
} as const;

export const SLACK_BLOCK_IDS = {
  MAIN_MENU_SECTION: 'main_menu_section',
  DASHBOARD_SECTION: 'dashboard_section',
  ORDER_SECTION: 'order_section',
  RETURN_SECTION: 'return_section',
  CLAIM_SECTION: 'claim_section',
  INVENTORY_SECTION: 'inventory_section',
  INSIGHT_SECTION: 'insight_section',
  ORDER_SELECT: 'order_select',
} as const;

export const SLACK_VIEW_IDS = {
  PRIMARY_ORDER: 'primary_order_view',
  RETURN_ORDER: 'return_order_view',
  CLAIM_VIEW: 'claim_view',
  GRN_VIEW: 'grn_view',
  SECONDARY_ORDER: 'secondary_order_view',
  INVOICE_VIEW: 'invoice_view',
  DISPATCH_VIEW: 'dispatch_view',
  ARS_VIEW: 'ars_view',
} as const;

export const SLACK_APP_HOME = {
  TAB_ID: 'home',
  PUBLISH_RATE_LIMIT_MS: 5000,
} as const;

export type SlackCommand = (typeof SLACK_COMMANDS)[keyof typeof SLACK_COMMANDS];
export type SlackCallbackId =
  (typeof SLACK_CALLBACK_IDS)[keyof typeof SLACK_CALLBACK_IDS];
export type SlackActionId =
  (typeof SLACK_ACTION_IDS)[keyof typeof SLACK_ACTION_IDS];
export type SlackBlockId =
  (typeof SLACK_BLOCK_IDS)[keyof typeof SLACK_BLOCK_IDS];
export type SlackViewId = (typeof SLACK_VIEW_IDS)[keyof typeof SLACK_VIEW_IDS];
