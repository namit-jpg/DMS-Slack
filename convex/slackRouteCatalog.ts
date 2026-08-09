/**
 * A complete, transport-neutral route catalogue. The dispatcher uses only
 * these identifiers and patterns; it does not rely on Bolt registrations.
 * Keeping this list beside the Convex ingress makes parity review mechanical.
 */
export type SlackRouteFamily =
  | 'command'
  | 'app_home'
  | 'primary_order'
  | 'primary_order_management'
  | 'primary_grn'
  | 'returns_claims'
  | 'dashboard_reports'
  | 'secondary_orders'
  | 'inventory'
  | 'ars'
  | 'ai_insights'
  | 'diagnostics';

export const exactActionFamilies = {
  search_products_button: 'primary_order',
  select_order_type: 'primary_order',
  review_order_quote: 'primary_order',
  submit_primary_order: 'primary_order',
  view_order_detail: 'primary_order_management',
  search_orders_button: 'primary_order_management',
  submit_grn_form: 'primary_grn',
  returns_menu: 'returns_claims',
  claims_menu: 'returns_claims',
  bulk_secondary_invoice: 'secondary_orders',
  returns_claims_menu: 'returns_claims',
  back_to_menu: 'dashboard_reports',
  cancel_action: 'dashboard_reports',
  insights_menu: 'dashboard_reports',
  refresh_insights: 'dashboard_reports',
  secondary_orders_menu: 'secondary_orders',
  search_so_button: 'secondary_orders',
  view_inventory: 'inventory',
  view_partial_orders: 'secondary_orders',
  ars_menu: 'ars',
  ars_search_button: 'ars',
  ars_toggle_status: 'ars',
  ars_view_orders: 'ars',
  inventory_select_location: 'inventory',
  ars_approve_changes: 'ars',
  ars_reject_changes: 'ars',
  ai_insights_menu: 'ai_insights',
  dms_diagnostics: 'diagnostics',
} as const satisfies Record<string, SlackRouteFamily>;

export const prefixActionFamilies = [
  { prefix: 'add_product_', family: 'primary_order' },
  { prefix: 'view_po_detail_', family: 'primary_order_management' },
  { prefix: 'mark_as_delivered_', family: 'primary_grn' },
  { prefix: 'process_grn_', family: 'primary_grn' },
  { prefix: 'view_ro_detail_', family: 'returns_claims' },
  { prefix: 'upload_return_file_', family: 'returns_claims' },
  { prefix: 'submit_return_approval_', family: 'returns_claims' },
  { prefix: 'file_claim_', family: 'returns_claims' },
  { prefix: 'submit_claim_', family: 'returns_claims' },
  { prefix: 'submit_approval_', family: 'returns_claims' },
  { prefix: 'view_so_detail_', family: 'secondary_orders' },
  { prefix: 'process_so_invoice_', family: 'secondary_orders' },
  { prefix: 'confirm_so_invoice_', family: 'secondary_orders' },
  { prefix: 'so_dispatch_deliver_', family: 'secondary_orders' },
  { prefix: 'submit_grn_', family: 'secondary_orders' },
  { prefix: 'replenish_order_', family: 'inventory' },
  { prefix: 'ars_edit_product_', family: 'ars' },
  { prefix: 'ars_submit_product_', family: 'ars' },
  { prefix: 'ars_request_change_', family: 'ars' },
  { prefix: 'ars_submit_change_request_', family: 'ars' },
  { prefix: 'ars_create_order_', family: 'ars' },
  { prefix: 'ars_deactivate_product_', family: 'ars' },
] as const satisfies ReadonlyArray<{ prefix: string; family: SlackRouteFamily }>;

export type ExactSlackActionId = keyof typeof exactActionFamilies;
export type PrefixSlackActionId = (typeof prefixActionFamilies)[number]['prefix'];
export type SlackActionHandlerId = ExactSlackActionId | PrefixSlackActionId;

export interface ResolvedSlackActionRoute {
  handlerId: SlackActionHandlerId;
  actionId: string;
  family: SlackRouteFamily;
  parameter: string | null;
}

export function resolveSlackActionRoute(actionId: string): ResolvedSlackActionRoute | null {
  const exactFamily = (exactActionFamilies as Record<string, SlackRouteFamily>)[actionId];
  if (exactFamily) {
    return { handlerId: actionId as ExactSlackActionId, actionId, family: exactFamily, parameter: null };
  }
  const prefix = prefixActionFamilies.find((candidate) => actionId.startsWith(candidate.prefix));
  if (!prefix) return null;
  return {
    handlerId: prefix.prefix,
    actionId,
    family: prefix.family,
    parameter: actionId.slice(prefix.prefix.length),
  };
}

export function routeFamilyForHandlerKey(handlerKey: string): SlackRouteFamily | null {
  if (handlerKey.startsWith('command:')) return 'command';
  if (handlerKey === 'event:app_home_opened') return 'app_home';
  if (!handlerKey.startsWith('action:')) return null;
  const actionId = handlerKey.slice('action:'.length);
  return resolveSlackActionRoute(actionId)?.family ?? null;
}

export const legacyActionRouteCount = Object.keys(exactActionFamilies).length + prefixActionFamilies.length;
