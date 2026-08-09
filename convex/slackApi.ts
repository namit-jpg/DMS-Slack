export interface SlackApiError {
  code: string;
  status: number;
}

export function isAllowedSlackResponseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'hooks.slack.com';
  } catch {
    return false;
  }
}

export async function postResponseUrl(responseUrl: string, body: Record<string, unknown>): Promise<void> {
  if (!isAllowedSlackResponseUrl(responseUrl)) throw new Error('Invalid Slack response URL');
  const response = await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Slack response URL failed with HTTP ${response.status}`);
}

export async function callSlackWebApi(token: string, method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    const error = new Error(`Slack Web API ${method} failed`) as Error & SlackApiError;
    error.code = typeof payload.error === 'string' ? payload.error : 'SLACK_API_ERROR';
    error.status = response.status;
    throw error;
  }
  return payload;
}
