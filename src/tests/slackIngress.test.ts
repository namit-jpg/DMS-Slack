import { describe, expect, it } from 'vitest';
import { normalizeSlackRequest, verifySlackRequest } from '../../convex/slackIngress';

const signingSecret = '8f742231b10e8888abcd99yyyzzz85a5';
const timestamp = '1531420618';
const rawBody = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
const signature = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503';

describe('Slack ingress security and normalization', () => {
  it('accepts Slack official HMAC test vector using the raw request body', async () => {
    await expect(verifySlackRequest(rawBody, timestamp, signature, signingSecret, Number(timestamp) * 1000)).resolves.toBe(true);
  });

  it('rejects stale and tampered requests', async () => {
    await expect(verifySlackRequest(rawBody, timestamp, signature, signingSecret, Number(timestamp) * 1000 + 300_001)).resolves.toBe(false);
    await expect(verifySlackRequest(`${rawBody}&tampered=true`, timestamp, signature, signingSecret, Number(timestamp) * 1000)).resolves.toBe(false);
  });

  it('normalizes and scopes a configured slash command', async () => {
    await expect(normalizeSlackRequest(
      'command=%2Fdms&team_id=T1&user_id=U1&channel_id=C1&text=orders&trigger_id=trigger&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2Fx',
      'application/x-www-form-urlencoded',
      { signingSecret: 'unused', teamId: 'T1', command: '/dms', now: 1 },
    )).resolves.toMatchObject({
      kind: 'command', teamId: 'T1', userId: 'U1', handlerKey: 'command:/dms', responseUrl: 'https://hooks.slack.com/commands/x',
    });
  });

  it('rejects requests from a different Slack workspace before dispatch', async () => {
    await expect(normalizeSlackRequest(
      'command=%2Fdms&team_id=T2&user_id=U1',
      'application/x-www-form-urlencoded',
      { signingSecret: 'unused', teamId: 'T1', command: '/dms', now: 1 },
    )).resolves.toBeNull();
  });

  it('does not answer a URL-verification challenge explicitly scoped to another workspace', async () => {
    await expect(normalizeSlackRequest(
      JSON.stringify({ type: 'url_verification', team_id: 'T2', challenge: 'challenge-value' }),
      'Application/JSON; Charset=UTF-8',
      { signingSecret: 'unused', teamId: 'T1', command: '/dms', now: 1 },
    )).resolves.toBeNull();
  });

  it('accepts Enterprise Grid App Home events only when the configured enterprise matches', async () => {
    await expect(normalizeSlackRequest(
      JSON.stringify({
        type: 'event_callback',
        team_id: 'T-child-workspace',
        enterprise_id: 'E-grid',
        event_id: 'Ev-home',
        event: { type: 'app_home_opened', user: 'U1', tab: 'home' },
      }),
      'application/json',
      { signingSecret: 'unused', teamId: 'E-grid', command: '/dms', now: 1 },
    )).resolves.toMatchObject({
      kind: 'event', sourceTeamId: 'T-child-workspace', teamId: 'E-grid', userId: 'U1', handlerKey: 'event:app_home_opened',
    });

    await expect(normalizeSlackRequest(
      JSON.stringify({
        type: 'event_callback',
        team_id: 'T-child-workspace',
        enterprise_id: 'E-other-grid',
        event_id: 'Ev-other-home',
        event: { type: 'app_home_opened', user: 'U1', tab: 'home' },
      }),
      'application/json',
      { signingSecret: 'unused', teamId: 'E-grid', command: '/dms', now: 1 },
    )).resolves.toBeNull();
  });

  it('retains only the interactive fields required by the dispatcher', async () => {
    const payload = encodeURIComponent(JSON.stringify({
      team: { id: 'T1' }, user: { id: 'U1' }, channel: { id: 'C1' }, message: { ts: '123.456' }, trigger_id: 'trigger-1',
      actions: [{ action_id: 'submit_claim_500', value: '500' }],
      state: { values: { claim_amount: { claim_input_amount: { value: '42.50' } } } },
      response_url: 'https://hooks.slack.com/actions/x',
    }));
    await expect(normalizeSlackRequest(`payload=${payload}`, 'application/x-www-form-urlencoded', {
      signingSecret: 'unused', teamId: 'T1', command: '/dms', now: 1,
    })).resolves.toMatchObject({
      kind: 'action', handlerKey: 'action:submit_claim_500', responseUrl: 'https://hooks.slack.com/actions/x',
      payload: {
        actionId: 'submit_claim_500', actionValue: '500', triggerId: 'trigger-1', channelId: 'C1', messageTs: '123.456',
        stateValues: { claim_amount: { claim_input_amount: { value: '42.50' } } },
      },
    });
  });

  it('accepts interactions from only the explicitly pinned Enterprise Grid child workspace', async () => {
    const interaction = (workspaceId: string) => `payload=${encodeURIComponent(JSON.stringify({
      team: { id: workspaceId },
      user: { id: 'U1' },
      actions: [{ action_id: 'select_order_type', value: 'primary' }],
    }))}`;
    const config = {
      signingSecret: 'unused', teamId: 'E-grid', workspaceId: 'T-child-workspace', command: '/dms' as const, now: 1,
    };

    await expect(normalizeSlackRequest(interaction('T-child-workspace'), 'application/x-www-form-urlencoded', config))
      .resolves.toMatchObject({ kind: 'action', sourceTeamId: 'T-child-workspace', teamId: 'E-grid', handlerKey: 'action:select_order_type' });
    await expect(normalizeSlackRequest(interaction('T-untrusted-workspace'), 'application/x-www-form-urlencoded', config))
      .resolves.toBeNull();
  });

  it('normalizes modal/container context and multi-select values used by migrated handlers', async () => {
    const payload = encodeURIComponent(JSON.stringify({
      team: { id: 'T1' },
      user: { id: 'U1' },
      trigger_id: 'trigger-2',
      container: { type: 'view', channel_id: 'C2', message_ts: '456.789' },
      view: { id: 'V1', hash: 'hash-1', callback_id: 'ars-edit', state: { values: { block: { input: { value: '12' } } } } },
      actions: [{ action_id: 'inventory_select_location', selected_conversations: ['C2', 'C3'] }],
    }));
    await expect(normalizeSlackRequest(`payload=${payload}`, 'application/x-www-form-urlencoded; charset=utf-8', {
      signingSecret: 'unused', teamId: 'T1', command: '/dms', now: 1,
    })).resolves.toMatchObject({
      kind: 'action',
      payload: {
        actionId: 'inventory_select_location',
        actionValue: ['C2', 'C3'],
        callbackId: 'ars-edit',
        triggerId: 'trigger-2',
        channelId: 'C2',
        messageTs: '456.789',
        containerType: 'view',
        viewId: 'V1',
        viewHash: 'hash-1',
        stateValues: { block: { input: { value: '12' } } },
      },
    });
  });
});
