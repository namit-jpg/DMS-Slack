import { httpActionGeneric, httpRouter } from 'convex/server';
import { buildFoundationHealthResponse } from './health';
import { receiveSlackRequest } from './slackIngress';

const http = httpRouter();

/**
 * The first public Convex route. Slack ingress is intentionally not registered
 * until signature verification, durable deduplication, and async dispatch are
 * implemented and tested in Phase 3.
 */
const health = httpActionGeneric(async () => new Response(
  JSON.stringify(buildFoundationHealthResponse()),
  {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  },
));

http.route({
  path: '/health',
  method: 'GET',
  handler: health,
});

http.route({
  path: '/slack/events',
  method: 'POST',
  handler: receiveSlackRequest,
});

export default http;
