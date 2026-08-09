import { describe, expect, it } from 'vitest';
import { legacyActionRouteCount, routeFamilyForHandlerKey } from '../../convex/slackRouteCatalog';

describe('Convex Slack route catalogue', () => {
  it('maps the command and app-home event without Bolt', () => {
    expect(routeFamilyForHandlerKey('command:/dms')).toBe('command');
    expect(routeFamilyForHandlerKey('event:app_home_opened')).toBe('app_home');
  });

  it('covers every legacy action registration by exact identifier or prefix family', () => {
    expect(legacyActionRouteCount).toBe(50);
    expect(routeFamilyForHandlerKey('action:add_product_01t123')).toBe('primary_order');
    expect(routeFamilyForHandlerKey('action:submit_grn_801123')).toBe('secondary_orders');
    expect(routeFamilyForHandlerKey('action:submit_grn_form')).toBe('primary_grn');
    expect(routeFamilyForHandlerKey('action:ars_submit_change_request_01t123')).toBe('ars');
    expect(routeFamilyForHandlerKey('action:not_a_real_route')).toBeNull();
  });
});
