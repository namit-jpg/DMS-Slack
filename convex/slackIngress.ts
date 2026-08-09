import { anyApi, httpActionGeneric } from 'convex/server';
import { env } from './_generated/server';

const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;
const INGRESS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RESPONSE_URL_RETENTION_MS = 15 * 60 * 1000;

export interface SlackIngressConfig {
  signingSecret: string;
  teamId: string;
  /**
   * The single child workspace where an Enterprise Grid installation has its
   * bot token. Some interactive deliveries omit `enterprise_id`, so this is
   * an explicit additional allow-list entry rather than a broad relaxation.
   */
  workspaceId?: string;
  command: '/dms';
  now?: number;
}

export interface NormalizedSlackIngress {
  dedupeKey: string;
  kind: 'command' | 'event' | 'action';
  /** The installed child workspace, retained for Enterprise Grid Slack API calls. */
  sourceTeamId?: string;
  teamId: string;
  userId: string;
  handlerKey: string;
  payload: Record<string, unknown>;
  responseUrl?: string;
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export async function verifySlackRequest(rawBody: string, timestamp: string | null, signature: string | null, signingSecret: string, now = Date.now()): Promise<boolean> {
  if (!timestamp || !signature || !/^v0=[0-9a-f]{64}$/i.test(signature)) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > MAX_REQUEST_AGE_MS) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const computed = `v0=${toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString)))}`;
  return timingSafeEqual(computed, signature);
}

function requireString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Produces a stable, non-sensitive reason for an ingress rejection. */
function normalizationFailureCode(rawBody: string, contentType: string | null, config: SlackIngressConfig): string {
  const normalizedContentType = contentType?.toLowerCase() ?? '';
  if (normalizedContentType.includes('application/json')) {
    try {
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      if (body.type === 'event_callback') {
        return isAuthorizedSlackScope(requireString(body.team_id), requireString(body.enterprise_id), config.teamId, config.workspaceId)
          ? 'EVENT_MISSING_REQUIRED_FIELDS'
          : 'EVENT_SCOPE_MISMATCH';
      }
      return 'UNSUPPORTED_JSON_PAYLOAD';
    } catch {
      return 'MALFORMED_JSON';
    }
  }
  if (!normalizedContentType.includes('application/x-www-form-urlencoded')) return 'UNSUPPORTED_CONTENT_TYPE';
  const form = new URLSearchParams(rawBody);
  const interactivePayload = form.get('payload');
  if (!interactivePayload) return 'FORM_MISSING_INTERACTION_PAYLOAD';
  try {
    const payload = JSON.parse(interactivePayload) as Record<string, unknown>;
    const team = object(payload.team);
    const enterprise = object(payload.enterprise);
    const teamId = requireString(team.id) ?? requireString(payload.team_id);
    const enterpriseId = requireString(enterprise.id) ?? requireString(payload.enterprise_id);
    if (!isAuthorizedSlackScope(teamId, enterpriseId, config.teamId, config.workspaceId)) return 'INTERACTION_SCOPE_MISMATCH';
    if (!requireString(object(payload.user).id)) return 'INTERACTION_MISSING_USER';
    if (!requireString((payload.actions as Array<Record<string, unknown>> | undefined)?.[0]?.action_id)) return 'INTERACTION_MISSING_ACTION';
    return 'INTERACTION_UNSUPPORTED';
  } catch {
    return 'MALFORMED_INTERACTION_PAYLOAD';
  }
}

/**
 * A Slack app can be installed at either workspace or Enterprise Grid level.
 * Workspace deliveries carry `team_id`; Enterprise Grid deliveries also carry
 * the child workspace team plus the configured `enterprise_id`.  Accepting an
 * enterprise-scoped deployment must still require the exact configured Grid
 * identifier, never merely any Enterprise Grid payload.
 */
function isAuthorizedSlackScope(
  teamId: string | null,
  enterpriseId: string | null,
  configuredScopeId: string,
  configuredWorkspaceId?: string,
): boolean {
  return teamId === configuredScopeId
    || enterpriseId === configuredScopeId
    || (configuredWorkspaceId !== undefined && teamId === configuredWorkspaceId);
}

function normalizedActionValue(action: Record<string, unknown>): unknown {
  const scalarKeys = [
    'value',
    'selected_date',
    'selected_time',
    'selected_date_time',
    'selected_user',
    'selected_conversation',
    'selected_channel',
  ];
  for (const key of scalarKeys) {
    if (typeof action[key] === 'string' || typeof action[key] === 'number') return action[key];
  }
  const selectedOption = requireString(object(action.selected_option).value);
  if (selectedOption) return selectedOption;
  if (Array.isArray(action.selected_options)) {
    return action.selected_options.map((option) => object(option).value).filter((value): value is string => typeof value === 'string');
  }
  const arrayKeys = ['selected_users', 'selected_conversations', 'selected_channels'];
  for (const key of arrayKeys) {
    if (Array.isArray(action[key])) return action[key].filter((value): value is string => typeof value === 'string');
  }
  return undefined;
}

export async function normalizeSlackRequest(rawBody: string, contentType: string | null, config: SlackIngressConfig): Promise<NormalizedSlackIngress | { challenge: string } | null> {
  const normalizedContentType = contentType?.toLowerCase() ?? '';
  if (normalizedContentType.includes('application/json')) {
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody) as Record<string, unknown>; } catch { return null; }
    if (body.type === 'url_verification' && requireString(body.challenge)) {
      const verificationTeamId = requireString(body.team_id);
      const verificationEnterpriseId = requireString(body.enterprise_id);
      if (!isAuthorizedSlackScope(verificationTeamId, verificationEnterpriseId, config.teamId, config.workspaceId)) return null;
      return { challenge: body.challenge as string };
    }
    const eventTeamId = requireString(body.team_id);
    const eventEnterpriseId = requireString(body.enterprise_id);
    if (body.type !== 'event_callback' || !isAuthorizedSlackScope(eventTeamId, eventEnterpriseId, config.teamId, config.workspaceId) || !requireString(body.event_id)) return null;
    const event = body.event as Record<string, unknown> | undefined;
    const userId = requireString(event?.user);
    const eventType = requireString(event?.type);
    if (!userId || !eventType) return null;
    return {
      dedupeKey: `event:${body.event_id as string}`,
      kind: 'event', sourceTeamId: eventTeamId ?? undefined, teamId: config.teamId, userId, handlerKey: `event:${eventType}`,
      payload: { eventType, eventId: body.event_id, eventTime: body.event_time, tab: event?.tab },
    };
  }

  if (!normalizedContentType.includes('application/x-www-form-urlencoded')) return null;
  const form = new URLSearchParams(rawBody);
  const interactivePayload = form.get('payload');
  if (interactivePayload) {
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(interactivePayload) as Record<string, unknown>; } catch { return null; }
    const team = object(payload.team);
    const enterprise = object(payload.enterprise);
    const user = object(payload.user);
    const channel = object(payload.channel);
    const container = object(payload.container);
    const message = object(payload.message);
    const view = object(payload.view);
    const viewStateValues = object(object(view.state).values);
    const messageStateValues = object(object(payload.state).values);
    const teamId = requireString(team.id) ?? requireString(payload.team_id);
    const enterpriseId = requireString(enterprise.id) ?? requireString(payload.enterprise_id);
    const userId = requireString(user.id);
    const action = (payload.actions as Array<Record<string, unknown>> | undefined)?.[0];
    const actionId = requireString(action?.action_id);
    if (!isAuthorizedSlackScope(teamId, enterpriseId, config.teamId, config.workspaceId) || !userId || !actionId) return null;
    const rawDedupe = `${teamId}:${userId}:${actionId}:${requireString(payload.trigger_id) ?? ''}:${rawBody}`;
    return {
      dedupeKey: `action:${await sha256(rawDedupe)}`,
      // Downstream identity enforcement is keyed by the configured single
      // workspace or Grid scope, not an arbitrary child workspace ID. The
      // source is retained only because Enterprise Grid's users.info requires
      // a child workspace argument for an org-installed bot token.
      kind: 'action', sourceTeamId: teamId ?? undefined, teamId: config.teamId, userId, handlerKey: `action:${actionId}`,
      payload: {
        actionId,
        actionValue: normalizedActionValue(action ?? {}),
        callbackId: requireString(view.callback_id) ?? requireString(payload.callback_id) ?? undefined,
        triggerId: requireString(payload.trigger_id) ?? undefined,
        channelId: requireString(channel.id) ?? requireString(container.channel_id) ?? undefined,
        messageTs: requireString(message.ts) ?? requireString(container.message_ts) ?? undefined,
        messageThreadTs: requireString(message.thread_ts) ?? undefined,
        containerType: requireString(container.type) ?? undefined,
        viewId: requireString(view.id) ?? undefined,
        viewHash: requireString(view.hash) ?? undefined,
        // Existing flows read form input from either a modal or message state.
        // The normalized state is retained only for the seven-day ingress TTL.
        stateValues: Object.keys(viewStateValues).length > 0 ? viewStateValues : messageStateValues,
      },
      responseUrl: requireString(payload.response_url) ?? undefined,
    };
  }

  const command = form.get('command');
  const teamId = form.get('team_id');
  const enterpriseId = form.get('enterprise_id');
  const userId = form.get('user_id');
  if (command !== config.command || !isAuthorizedSlackScope(teamId, enterpriseId, config.teamId, config.workspaceId) || !userId) return null;
  return {
    dedupeKey: `command:${await sha256(`${teamId}:${userId}:${form.get('trigger_id') ?? ''}:${rawBody}`)}`,
    kind: 'command', sourceTeamId: teamId ?? undefined, teamId: config.teamId, userId, handlerKey: `command:${command}`,
    payload: { command, text: form.get('text') ?? '', channelId: form.get('channel_id'), triggerId: form.get('trigger_id') },
    responseUrl: form.get('response_url') ?? undefined,
  };
}

export const receiveSlackRequest = httpActionGeneric(async (ctx, request) => {
  const rawBody = await request.text();
  const now = Date.now();
  const deploymentEnv = env as typeof env & { readonly SLACK_WORKSPACE_ID?: string };
  const config = {
    signingSecret: env.SLACK_SIGNING_SECRET,
    teamId: env.SLACK_TEAM_ID,
    workspaceId: deploymentEnv.SLACK_WORKSPACE_ID,
    // Generated Convex bindings may lag a local manifest-only command
    // narrowing; the deployment contract accepts only `/dms`.
    command: env.SLACK_COMMAND as '/dms',
    now,
  };
  const valid = await verifySlackRequest(rawBody, request.headers.get('x-slack-request-timestamp'), request.headers.get('x-slack-signature'), config.signingSecret, now);
  if (!valid) {
    console.warn('DMS Slack ingress rejected an invalid signature', {
      contentType: request.headers.get('content-type')?.split(';')[0] ?? 'missing',
      hasTimestamp: Boolean(request.headers.get('x-slack-request-timestamp')),
      hasSignature: Boolean(request.headers.get('x-slack-signature')),
    });
    return jsonResponse({ error: 'invalid_request' }, 401);
  }

  const normalized = await normalizeSlackRequest(rawBody, request.headers.get('content-type'), config);
  if (!normalized) {
    console.warn('DMS Slack ingress rejected an unsupported payload', {
      code: normalizationFailureCode(rawBody, request.headers.get('content-type'), config),
    });
    return jsonResponse({ error: 'unsupported_request' }, 400);
  }
  if ('challenge' in normalized) return jsonResponse({ challenge: normalized.challenge }, 200);

  await ctx.runMutation(anyApi.operationalState.acceptSlackIngress, {
    ...normalized,
    receivedAt: now,
    responseUrlExpiresAt: normalized.responseUrl ? now + RESPONSE_URL_RETENTION_MS : undefined,
    expiresAt: now + INGRESS_RETENTION_MS,
  });
  return new Response(null, { status: 200 });
});
