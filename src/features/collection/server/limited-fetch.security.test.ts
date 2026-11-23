// Hostile addresses and answers against the fetch limits of the collection job: plain http,
// names and redirects that lead to private, loopback or metadata addresses, endless redirects,
// oversized and compressed bodies and slow servers. MSW plays the servers; the resolver says
// which addresses each test host has. The last cases run the whole job, to show that a feed or a
// page behind such an address is refused and never reached.
import { eq } from 'drizzle-orm';
import { delay, http, HttpResponse } from 'msw';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { articles } from '../../articles/index.ts';
import {
  articleHtml,
  articlePage,
  feedServer,
  isolatedDatabase,
  makeFeedDue,
  resetCollectionTables,
  rssFeed,
  testConfig,
  testDependencies,
  testResolver,
  type IsolatedDatabase,
} from '../testing.ts';
import { runCollection } from './collection-run.ts';
import { FETCH_LIMITS, FetchFailure, fetchLimited, type FetchOptions } from './limited-fetch.ts';
import { feedCursors, seenItems } from './schema.ts';

const feeds = feedServer();
const requested: string[] = [];

beforeAll(() => {
  feeds.listen();
  feeds.server.events.on('request:start', ({ request }) => {
    requested.push(request.url);
  });
});

afterEach(() => {
  feeds.server.resetHandlers();
  requested.length = 0;
  vi.restoreAllMocks();
});

afterAll(() => {
  feeds.server.close();
});

const hostileHosts = {
  'metadata.example.org': ['169.254.169.254'],
  'internal.example.org': ['192.168.1.5'],
  'loopback.example.org': ['::1'],
  'mixed.example.org': ['93.184.215.14', '10.0.0.8'],
};

const options: FetchOptions = {
  resolveHost: testResolver(hostileHosts),
  userAgent: 'vexto/test (+https://example.org/repo)',
  accept: 'application/rss+xml',
};

async function failureOf(url: string, given: FetchOptions = options) {
  try {
    await fetchLimited(url, given);
  } catch (error) {
    expect(error).toBeInstanceOf(FetchFailure);
    return error as FetchFailure;
  }
  throw new Error(`${url} was fetched.`);
}

function redirect(from: string, to: string, status = 302) {
  return http.get(from, () => new HttpResponse(null, { status, headers: { Location: to } }));
}

/** Redirects /<name>/0 to /<name>/1 and so on, `redirects` times, and answers at the end. */
function redirectChain(name: string, redirects: number) {
  for (let hop = 0; hop < redirects; hop += 1) {
    const status = [301, 302, 303, 307, 308][hop % 5];
    feeds.server.use(
      redirect(`https://feeds.example.org/${name}/${hop}`, `/${name}/${hop + 1}`, status),
    );
  }
  feeds.server.use(
    http.get(`https://feeds.example.org/${name}/${redirects}`, () => HttpResponse.text('end')),
  );
}

describe('fetchLimited', () => {
  it('fetches a public https address and sends the fixed User-Agent', async () => {
    let userAgent: string | null = null;
    feeds.server.use(
      http.get('https://feeds.example.org/ok', ({ request }) => {
        userAgent = request.headers.get('user-agent');
        return HttpResponse.text('<rss/>', { headers: { 'Content-Type': 'application/rss+xml' } });
      }),
    );

    const resource = await fetchLimited('https://feeds.example.org/ok', options);

    expect(resource.body.toString()).toBe('<rss/>');
    expect(resource.contentType).toBe('application/rss+xml');
    expect(userAgent).toBe('vexto/test (+https://example.org/repo)');
  });

  it('refuses plain http without sending anything', async () => {
    const failure = await failureOf('http://feeds.example.org/feed.xml');

    expect(failure.reason).toBe('not_https');
    expect(failure.temporary).toBe(false);
    expect(requested).toEqual([]);
  });

  it.each([
    ['the cloud metadata address', 'https://metadata.example.org/computeMetadata/v1/'],
    ['a private address', 'https://internal.example.org/admin'],
    ['the IPv6 loopback', 'https://loopback.example.org/'],
    ['a public and a private address', 'https://mixed.example.org/'],
    ['a literal loopback address', 'https://127.0.0.1/'],
    ['a literal metadata address', 'https://169.254.169.254/latest/meta-data/'],
    ['a literal IPv6 loopback address', 'https://[::1]/'],
  ])('refuses a host that resolves to %s, without connecting', async (_name, url) => {
    const failure = await failureOf(url);

    expect(failure.reason).toBe('address_not_allowed');
    expect(failure.temporary).toBe(false);
    expect(requested).toEqual([]);
  });

  it('checks a redirect target again and refuses one that leads to a private address', async () => {
    feeds.server.use(
      redirect('https://feeds.example.org/moved', 'https://metadata.example.org/token'),
    );

    const failure = await failureOf('https://feeds.example.org/moved');

    expect(failure.reason).toBe('address_not_allowed');
    expect(requested).toEqual(['https://feeds.example.org/moved']);
  });

  it('refuses a redirect to plain http', async () => {
    feeds.server.use(redirect('https://feeds.example.org/down', 'http://feeds.example.org/feed'));

    expect((await failureOf('https://feeds.example.org/down')).reason).toBe('not_https');
  });

  it('follows five redirects and refuses the sixth', async () => {
    redirectChain('five', 5);
    redirectChain('six', 6);

    const reached = await fetchLimited('https://feeds.example.org/five/0', options);
    expect(reached.url).toBe('https://feeds.example.org/five/5');
    expect(reached.body.toString()).toBe('end');

    const failure = await failureOf('https://feeds.example.org/six/0');
    expect(failure.reason).toBe('too_many_redirects');
    expect(failure.temporary).toBe(false);
    expect(requested).not.toContain('https://feeds.example.org/six/6');
  });

  it('refuses a body larger than 2 MB that says its length', async () => {
    feeds.server.use(
      http.get('https://feeds.example.org/big', () =>
        HttpResponse.text('x'.repeat(FETCH_LIMITS.maxBytes + 1)),
      ),
    );

    const failure = await failureOf('https://feeds.example.org/big');

    expect(failure.reason).toBe('too_large');
    expect(failure.temporary).toBe(false);
  });

  it('stops reading a streamed body once it passes 2 MB', async () => {
    let sent = 0;
    feeds.server.use(
      http.get('https://feeds.example.org/stream', () => {
        const chunk = new Uint8Array(256 * 1024).fill(120);
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            sent += chunk.length;
            controller.enqueue(chunk);
            if (sent > 64 * 1024 * 1024) {
              controller.close();
            }
          },
        });
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/html' } });
      }),
    );

    const failure = await failureOf('https://feeds.example.org/stream');

    expect(failure.reason).toBe('too_large');
    expect(sent).toBeLessThan(16 * 1024 * 1024);
  });

  it('refuses a compressed body that grows past 2 MB', async () => {
    const bomb = gzipSync(Buffer.alloc(FETCH_LIMITS.maxBytes * 4));
    feeds.server.use(
      http.get(
        'https://feeds.example.org/bomb',
        () => new HttpResponse(bomb, { headers: { 'Content-Encoding': 'gzip' } }),
      ),
    );

    expect(bomb.length).toBeLessThan(FETCH_LIMITS.maxBytes);
    expect((await failureOf('https://feeds.example.org/bomb')).reason).toBe('too_large');
  });

  it('decodes a compressed body within the limit', async () => {
    feeds.server.use(
      http.get(
        'https://feeds.example.org/gzip',
        () =>
          new HttpResponse(gzipSync(Buffer.from('<rss/>')), {
            headers: { 'Content-Encoding': 'gzip' },
          }),
      ),
    );

    expect((await fetchLimited('https://feeds.example.org/gzip', options)).body.toString()).toBe(
      '<rss/>',
    );
  });

  it('gives up on a server that does not answer in time, as a failure for now', async () => {
    feeds.server.use(
      http.get('https://feeds.example.org/slow', async () => {
        await delay(2000);
        return HttpResponse.text('late');
      }),
    );

    const failure = await failureOf('https://feeds.example.org/slow', {
      ...options,
      limits: { ...FETCH_LIMITS, timeoutMs: 100 },
    });

    expect(failure.reason).toBe('timeout');
    expect(failure.temporary).toBe(true);
  });

  it('cuts off a body that arrives too slowly', async () => {
    feeds.server.use(
      http.get('https://feeds.example.org/trickle', () => {
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            await delay(50);
            controller.enqueue(new Uint8Array([120]));
          },
        });
        return new HttpResponse(stream);
      }),
    );

    const failure = await failureOf('https://feeds.example.org/trickle', {
      ...options,
      limits: { ...FETCH_LIMITS, timeoutMs: 300 },
    });

    expect(failure.reason).toBe('timeout');
  });

  it.each([
    [404, false],
    [410, false],
    [408, true],
    [429, true],
    [500, true],
    [503, true],
  ])('tells a %i answer as a failure that is temporary: %s', async (status, temporary) => {
    feeds.server.use(
      http.get('https://feeds.example.org/status', () => new HttpResponse(null, { status })),
    );

    const failure = await failureOf('https://feeds.example.org/status');

    expect(failure).toMatchObject({ reason: 'http_status', status, temporary });
  });

  it('tells a network error as a failure for now', async () => {
    feeds.server.use(http.get('https://feeds.example.org/reset', () => HttpResponse.error()));

    const failure = await failureOf('https://feeds.example.org/reset');

    expect(failure).toMatchObject({ reason: 'network', temporary: true });
  });
});

describe('the collection job behind hostile addresses', () => {
  let db: IsolatedDatabase;

  beforeAll(async () => {
    db = await isolatedDatabase();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    await resetCollectionTables(db.database);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  const config = testConfig({
    'nist-news': { url: 'https://feeds.example.org/pages.xml', body: 'page', perRun: 2 },
  });

  function run() {
    return runCollection(
      testDependencies(db.database, { config, resolveHost: testResolver(hostileHosts) }),
    );
  }

  it('skips an entry whose page redirects to the metadata address and remembers it', async () => {
    feeds.server.use(
      http.get('https://feeds.example.org/pages.xml', () =>
        HttpResponse.text(
          rssFeed([
            { link: 'https://news.example.org/moved', title: 'Moved' },
            { link: 'https://internal.example.org/story', title: 'Internal' },
          ]),
        ),
      ),
      redirect('https://news.example.org/moved', 'https://metadata.example.org/latest/'),
      http.get('https://news.example.org/:any', () =>
        HttpResponse.html(articlePage('Fine', articleHtml('fine', 20))),
      ),
    );
    await makeFeedDue(db.database, 'nist-news', config);

    await run();

    expect(await db.database.select().from(articles)).toEqual([]);
    expect(await db.database.select().from(seenItems)).toHaveLength(2);
    expect(requested.filter((url) => !url.includes('feeds.example.org'))).toEqual([
      'https://news.example.org/moved',
    ]);
  });

  it('counts a feed on a private address as a failed read', async () => {
    const privateFeed = testConfig({
      'nist-news': { url: 'https://internal.example.org/feed.xml', body: 'page' },
    });
    await makeFeedDue(db.database, 'nist-news', privateFeed);

    await runCollection(
      testDependencies(db.database, {
        config: privateFeed,
        resolveHost: testResolver(hostileHosts),
      }),
    );

    const [cursor] = await db.database
      .select()
      .from(feedCursors)
      .where(eq(feedCursors.feedKey, 'nist-news'));
    expect(cursor.failedAttempts).toBe(1);
    expect(requested).toEqual([]);
  });
});
