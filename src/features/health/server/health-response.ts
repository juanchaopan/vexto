import { getHealthStatus } from '../domain/health-status.ts';

/** JSON health response; `no-store` keeps caches from answering for a service that is down. */
export function createHealthResponse(): Response {
  return Response.json(getHealthStatus(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** Answer for methods the health check does not support; HEAD is served from GET. */
export function createMethodNotAllowedResponse(): Response {
  return new Response(null, {
    status: 405,
    headers: { Allow: 'GET, HEAD' },
  });
}
