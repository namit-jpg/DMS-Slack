export interface FoundationHealthResponse {
  status: 'ok';
  service: 'dms-slack';
  runtime: 'convex';
  migrationPhase: 'foundation';
  slackIngress: 'not_configured';
  salesforce: 'not_configured';
  scheduler: 'not_configured';
  timestamp: string;
}

/**
 * Keep this payload public-safe: no deployment identity, account details,
 * configuration values, credentials, URLs, or raw integration errors.
 */
export function buildFoundationHealthResponse(now = new Date()): FoundationHealthResponse {
  return {
    status: 'ok',
    service: 'dms-slack',
    runtime: 'convex',
    migrationPhase: 'foundation',
    slackIngress: 'not_configured',
    salesforce: 'not_configured',
    scheduler: 'not_configured',
    timestamp: now.toISOString(),
  };
}
