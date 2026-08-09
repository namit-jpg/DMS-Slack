import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFoundationHealthResponse } from '../../convex/health';
import http from '../../convex/http';

describe('Convex foundation health payload', () => {
  it('returns a public-safe, deterministic health response', () => {
    expect(buildFoundationHealthResponse(new Date('2026-08-09T12:00:00.000Z'))).toEqual({
      status: 'ok',
      service: 'dms-slack',
      runtime: 'convex',
      migrationPhase: 'foundation',
      slackIngress: 'not_configured',
      salesforce: 'not_configured',
      scheduler: 'not_configured',
      timestamp: '2026-08-09T12:00:00.000Z',
    });
  });

  it('registers the health route and Slack ingress only for POST requests', () => {
    expect(http.lookup('/health', 'GET')).not.toBeNull();
    expect(http.lookup('/slack/events', 'POST')).not.toBeNull();
    expect(http.lookup('/slack/events', 'GET')).toBeNull();
  });

  it('keeps secondary-order polling absent from the deployed cron registry', () => {
    const cronSource = readFileSync('convex/crons.ts', 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cronSource).toContain("crons.hourly('reconcile overdue partial-order reminders'");
    expect(cronSource).not.toContain('secondaryOrderPolling.reconcileEnabledScopes');
    expect(cronSource).not.toMatch(/crons\.(?:interval|hourly|daily|weekly|monthly)\([^;]*secondaryOrderPolling/s);
  });
});
