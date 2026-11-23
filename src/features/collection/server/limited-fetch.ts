// Fetching feeds and original pages within the limits of .docs/design/rules.md (抓取的限制):
// https only, 10 seconds per request, at most 2 MB of body (read as a stream and stopped once it
// is larger), at most 5 redirects with every target checked again, and public addresses only.
// The host name is resolved first and every address it resolves to is checked; the connection
// then goes to those checked addresses, never to a second lookup, so a name that changes its
// answer between the check and the connection (DNS rebinding) cannot reach an internal address.
import type { IncomingMessage } from 'node:http';
// The module object rather than a named import, so the request goes through whatever the module
// provides at call time, as test doubles of the network replace it.
import https, { type RequestOptions } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { isPublicAddress, type HostResolver, type ResolvedAddress } from './address-policy.ts';

export type FetchLimits = { timeoutMs: number; maxBytes: number; maxRedirects: number };

export const FETCH_LIMITS: FetchLimits = {
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
};

/**
 * Why a fetch failed. `http_status` carries the status; a missing or unusable redirect target is
 * `bad_redirect`, and a body in an encoding that cannot be decoded is `bad_encoding`.
 */
export type FetchFailureReason =
  | 'not_https'
  | 'address_not_allowed'
  | 'too_many_redirects'
  | 'too_large'
  | 'timeout'
  | 'network'
  | 'http_status'
  | 'bad_redirect'
  | 'bad_encoding';

export class FetchFailure extends Error {
  readonly reason: FetchFailureReason;
  readonly status: number | undefined;

  constructor(reason: FetchFailureReason, message: string, status?: number) {
    super(message);
    this.name = 'FetchFailure';
    this.reason = reason;
    this.status = status;
  }

  /**
   * Whether trying again later can succeed: network errors, timeouts, 5xx, 408 and 429. Every
   * other failure, such as another 4xx, a body over the limit or an address that is not allowed,
   * is permanent.
   */
  get temporary(): boolean {
    if (this.reason === 'timeout' || this.reason === 'network') {
      return true;
    }
    const status = this.status ?? 0;
    return this.reason === 'http_status' && (status >= 500 || status === 408 || status === 429);
  }
}

export type FetchedResource = {
  /** The address that answered, after any redirects. */
  url: string;
  contentType: string | null;
  body: Buffer;
};

export type FetchOptions = {
  resolveHost: HostResolver;
  userAgent: string;
  accept: string;
  limits?: FetchLimits;
};

type Hop = { kind: 'redirect'; location: string } | { kind: 'resource'; resource: FetchedResource };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** The address as a URL, which must be https; `base` resolves a relative redirect target. */
function httpsUrl(address: string, base?: URL): URL {
  if (!URL.canParse(address, base)) {
    throw new FetchFailure('bad_redirect', 'The address is not a URL.');
  }
  const url = new URL(address, base);
  if (url.protocol !== 'https:') {
    throw new FetchFailure('not_https', `Only https addresses are fetched, not ${url.protocol}.`);
  }
  return url;
}

async function resolvedAddresses(hostname: string, resolveHost: HostResolver) {
  const family = isIP(hostname);
  if (family) {
    return [{ address: hostname, family: family === 6 ? 6 : 4 } as const];
  }
  try {
    return await resolveHost(hostname);
  } catch (error) {
    throw new FetchFailure('network', `${hostname} could not be resolved: ${messageOf(error)}`);
  }
}

/** The host's addresses, every one of them public; a literal IP address is checked as it is. */
async function allowedAddresses(url: URL, resolveHost: HostResolver) {
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const addresses = await resolvedAddresses(hostname, resolveHost);
  if (addresses.length === 0) {
    throw new FetchFailure('network', `${hostname} has no addresses.`);
  }
  if (!addresses.every(({ address }) => isPublicAddress(address))) {
    throw new FetchFailure('address_not_allowed', `${hostname} resolves to a non-public address.`);
  }
  return addresses;
}

function familyNumber(family: number | string | undefined) {
  if (family === 'IPv4') {
    return 4;
  }
  return family === 'IPv6' ? 6 : family;
}

/** A lookup that answers with the checked addresses only, so the socket connects to one of them. */
export function pinnedLookup(addresses: readonly ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const wanted = familyNumber(options.family);
    const matching = addresses.filter(({ family }) => !wanted || wanted === family);
    const usable = matching.length > 0 ? matching : addresses;
    if (options.all) {
      callback(
        null,
        usable.map(({ address, family }) => ({ address, family })),
      );
    } else {
      callback(null, usable[0].address, usable[0].family);
    }
  };
}

function tooLarge(maxBytes: number) {
  return new FetchFailure('too_large', `The body is larger than ${maxBytes} bytes.`);
}

async function readCapped(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) {
      throw tooLarge(maxBytes);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function decompress(raw: Buffer, encoding: string, maxBytes: number): Buffer {
  switch (encoding) {
    case 'identity':
    case '':
      return raw;
    case 'gzip':
    case 'x-gzip':
      return gunzipSync(raw, { maxOutputLength: maxBytes });
    case 'deflate':
      return inflateSync(raw, { maxOutputLength: maxBytes });
    case 'br':
      return brotliDecompressSync(raw, { maxOutputLength: maxBytes });
    default:
      throw new FetchFailure('bad_encoding', `The body's encoding ${encoding} is not supported.`);
  }
}

/** The body without its content encoding; the decoded body is held to the same limit. */
function decodeContent(raw: Buffer, header: string | undefined, maxBytes: number): Buffer {
  const encoding = (header ?? 'identity').trim().toLowerCase();
  try {
    return decompress(raw, encoding, maxBytes);
  } catch (error) {
    if (error instanceof FetchFailure) {
      throw error;
    }
    if (error instanceof RangeError) {
      throw tooLarge(maxBytes);
    }
    throw new FetchFailure('bad_encoding', `The ${encoding} body could not be decoded.`);
  }
}

async function readHop(response: IncomingMessage, url: URL, limits: FetchLimits): Promise<Hop> {
  const status = response.statusCode ?? 0;
  if (REDIRECT_STATUSES.has(status)) {
    response.destroy();
    const location = response.headers.location;
    if (!location) {
      throw new FetchFailure('bad_redirect', `The ${status} redirect has no Location.`, status);
    }
    return { kind: 'redirect', location };
  }
  if (status < 200 || status > 299) {
    response.destroy();
    throw new FetchFailure('http_status', `The server answered ${status}.`, status);
  }
  if (Number(response.headers['content-length']) > limits.maxBytes) {
    response.destroy();
    throw tooLarge(limits.maxBytes);
  }
  const raw = await readCapped(response, limits.maxBytes);
  const body = decodeContent(raw, response.headers['content-encoding'], limits.maxBytes);
  const contentType = response.headers['content-type'] ?? null;
  return { kind: 'resource', resource: { url: url.href, contentType, body } };
}

function requestOptions(addresses: readonly ResolvedAddress[], options: FetchOptions) {
  const settings: RequestOptions = {
    method: 'GET',
    headers: {
      'User-Agent': options.userAgent,
      Accept: options.accept,
      'Accept-Encoding': 'gzip, deflate, br',
    },
    lookup: pinnedLookup(addresses),
    // A connection of its own, so no pooled socket is ever shared between hosts.
    agent: false,
  };
  return settings;
}

/**
 * One request, answered within the time limit with its whole body. The limit runs until the
 * body is read, so a server that sends its body slowly is cut off as well.
 */
function requestOnce(
  url: URL,
  addresses: readonly ResolvedAddress[],
  options: FetchOptions,
  limits: FetchLimits,
): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    let timedOut: FetchFailure | undefined;
    const request = https.request(url, requestOptions(addresses, options), (response) => {
      readHop(response, url, limits).then(succeed, fail);
    });
    const timer = setTimeout(() => {
      timedOut = new FetchFailure('timeout', `No complete answer within ${limits.timeoutMs} ms.`);
      request.destroy(timedOut);
    }, limits.timeoutMs);
    function succeed(hop: Hop) {
      clearTimeout(timer);
      resolve(hop);
    }
    function fail(error: unknown) {
      clearTimeout(timer);
      const failure =
        error instanceof FetchFailure ? error : new FetchFailure('network', messageOf(error));
      reject(timedOut ?? failure);
    }
    request.once('error', fail);
    request.end();
  });
}

/** Fetches an https address within the limits; throws a FetchFailure when it cannot. */
export async function fetchLimited(
  address: string,
  options: FetchOptions,
): Promise<FetchedResource> {
  const limits = options.limits ?? FETCH_LIMITS;
  let url = httpsUrl(address);
  for (let redirects = 0; ; redirects += 1) {
    const addresses = await allowedAddresses(url, options.resolveHost);
    const hop = await requestOnce(url, addresses, options, limits);
    if (hop.kind === 'resource') {
      return hop.resource;
    }
    if (redirects >= limits.maxRedirects) {
      throw new FetchFailure('too_many_redirects', `More than ${limits.maxRedirects} redirects.`);
    }
    url = httpsUrl(hop.location, url);
  }
}
