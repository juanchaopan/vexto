// A small JSON-over-HTTP server for the Cloud Run services. Each route is a handler keyed by
// method and path; the server reads the JSON body, calls the handler and writes its answer with
// `Cache-Control: no-store`. Errors use the body the interfaces define for the services:
// { error: { code, message, retryable } }. No request, however malformed, may end the process:
// a target that is not a path is refused, and any failure while answering is logged and answered
// with a 500.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { errorFields, log } from './log.ts';

export type JsonRequest = { body: unknown };

/** An answer; a 204 answer or one without a body is sent with no content. */
export type JsonResponse = { status: number; body?: unknown };

export type RouteHandler = (request: JsonRequest) => JsonResponse | Promise<JsonResponse>;

/** Handlers by method and path, such as `POST /synthesize`. */
export type Routes = Readonly<Record<string, RouteHandler>>;

/** Request bodies are small JSON documents; anything larger is refused. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Port Cloud Run gives the container in PORT; 8080 when it is not set. */
export function portFromEnv(env: Readonly<Record<string, string | undefined>>): number {
  const value = env.PORT;
  if (value === undefined || value === '') {
    return 8080;
  }
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65535) {
    throw new Error(`PORT must be a port number, not "${value}".`);
  }
  return port;
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): JsonResponse {
  return { status, body: { error: { code, message, retryable } } };
}

const internalError = () =>
  errorResponse(500, 'INTERNAL', 'The request failed unexpectedly.', true);

/**
 * The health check of a service, served at `GET /health`: answering at all means the service is
 * up. Cloud Run keeps paths ending in z, such as /healthz, to itself, so they never reach it.
 */
export function health(): JsonResponse {
  return { status: 200, body: { status: 'ok' } };
}

class BodyError extends Error {}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new BodyError(`The request body is larger than ${MAX_BODY_BYTES} bytes.`);
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BodyError('The request body is not JSON.');
  }
}

/**
 * The path of the request target, or undefined when the target cannot be read as one. Node's
 * parser lets through targets such as `//[`, which the URL parser refuses.
 */
function requestPath(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

function unmatched(routes: Routes, method: string, path: string): JsonResponse {
  const pathKnown = Object.keys(routes).some((key) => key.slice(key.indexOf(' ') + 1) === path);
  return pathKnown
    ? errorResponse(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed on ${path}.`, false)
    : errorResponse(404, 'NOT_FOUND', `Nothing is served at ${path}.`, false);
}

async function answer(routes: Routes, request: IncomingMessage): Promise<JsonResponse> {
  const method = request.method ?? 'GET';
  const path = requestPath(request);
  if (path === undefined) {
    return errorResponse(400, 'INVALID_INPUT', 'The request target is not a valid path.', false);
  }
  const handler = routes[`${method} ${path}`];
  if (!handler) {
    return unmatched(routes, method, path);
  }
  try {
    return await handler({ body: await readJsonBody(request) });
  } catch (error) {
    if (error instanceof BodyError) {
      return errorResponse(422, 'INVALID_INPUT', error.message, false);
    }
    log('ERROR', 'The request failed unexpectedly.', { method, path, ...errorFields(error) });
    return internalError();
  }
}

/** Writes the answer; the body is turned into JSON before anything is written. */
function send(response: ServerResponse, { status, body }: JsonResponse) {
  const content = status === 204 || body === undefined ? undefined : JSON.stringify(body);
  response.setHeader('Cache-Control', 'no-store');
  if (content === undefined) {
    response.writeHead(status).end();
    return;
  }
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(content);
}

/**
 * Answers a request whose answer could not be written, such as one whose body cannot be turned
 * into JSON: a 500 while nothing has been written yet, otherwise the connection is closed.
 */
function sendFailure(response: ServerResponse, error: unknown) {
  log('ERROR', 'Answering a request failed.', errorFields(error));
  try {
    send(response, internalError());
  } catch {
    response.destroy();
  }
}

export function createJsonServer(routes: Routes): Server {
  return createServer((request, response) => {
    answer(routes, request)
      .then((result) => send(response, result))
      .catch((error: unknown) => sendFailure(response, error));
  });
}

/** Starts listening and resolves to the port the server listens on. */
export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}

/**
 * Runs a service until Cloud Run stops it: listens on PORT, logs the port, and on SIGTERM stops
 * taking requests and exits once the requests in progress have been answered.
 */
export async function serve(server: Server, name: string) {
  const port = await listen(server, portFromEnv(process.env));
  log('INFO', `${name} is listening.`, { service: name, port });
  process.once('SIGTERM', () => {
    log('INFO', `${name} is stopping.`, { service: name });
    server.close(() => process.exit(0));
  });
}
