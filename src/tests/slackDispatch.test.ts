import { describe, expect, it } from 'vitest';
import { shouldPublishHomeResponse } from '../../convex/slackDispatch';

describe('Slack response transport', () => {
  it('publishes a replacement Home view for App Home interactions', () => {
    expect(shouldPublishHomeResponse({ payload: { containerType: 'view' } })).toBe(true);
  });

  it('retains response-url delivery for ordinary message and modal interactions', () => {
    expect(shouldPublishHomeResponse({ payload: { containerType: 'message' } })).toBe(false);
    expect(shouldPublishHomeResponse({ payload: {} })).toBe(false);
  });
});
