import { describe, expect, it } from 'vitest';
import {
  hasTraceReceiver,
  traceIdRatioSampler,
  tracingConfiguration,
  urlQueryRemover,
  withoutUrlQueries,
} from './tracing.ts';

const config = { serviceName: 'test-web', traceSampleRatio: 0.25 };

describe('hasTraceReceiver', () => {
  it('is true on Vercel or with an OTLP endpoint', () => {
    expect(hasTraceReceiver({ VERCEL: '1' })).toBe(true);
    expect(hasTraceReceiver({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' })).toBe(true);
    expect(
      hasTraceReceiver({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://localhost:4318/v1/traces' }),
    ).toBe(true);
  });

  it('is false anywhere else, also for blank endpoints', () => {
    expect(hasTraceReceiver({})).toBe(false);
    expect(hasTraceReceiver({ NODE_ENV: 'production', OTEL_EXPORTER_OTLP_ENDPOINT: ' ' })).toBe(
      false,
    );
  });
});

describe('tracingConfiguration', () => {
  it('is null when nothing would receive the spans', () => {
    expect(tracingConfiguration({}, config)).toBeNull();
  });

  it('names the service, samples by the configured ratio and cuts queries before exporting', () => {
    const configuration = tracingConfiguration({ VERCEL: '1' }, config);
    expect(configuration?.serviceName).toBe('test-web');
    expect(String(configuration?.traceSampler)).toBe('TraceIdRatioSampler{0.25}');
    expect(configuration?.spanProcessors).toEqual([urlQueryRemover, 'auto']);
  });

  it('leaves the sampling to OTEL_TRACES_SAMPLER when it is set', () => {
    const configuration = tracingConfiguration(
      { VERCEL: '1', OTEL_TRACES_SAMPLER: 'always_on' },
      config,
    );
    expect(configuration?.traceSampler).toBe('auto');
  });
});

describe('traceIdRatioSampler', () => {
  const decide = (ratio: number, traceId: string) =>
    traceIdRatioSampler(ratio).shouldSample(
      undefined as never,
      traceId,
      'GET /api/articles',
      0,
      {},
      [],
    ).decision;
  const traceId = (last: string) => `0af7651916cd43dd8448eb21${last}`;

  it('traces a trace whose last 32 bits fall under the ratio', () => {
    expect(decide(0.25, traceId('00000000'))).toBe(2);
    expect(decide(0.25, traceId('3fffffff'))).toBe(2);
    expect(decide(0.25, traceId('40000000'))).toBe(0);
    expect(decide(0.25, traceId('ffffffff'))).toBe(0);
  });

  it('traces nothing at 0 and every trace at 1', () => {
    expect(decide(0, traceId('00000000'))).toBe(0);
    expect(decide(1, traceId('ffffffff'))).toBe(2);
  });

  it('decides every span of one trace alike', () => {
    const id = traceId('1234abcd');
    expect(new Set(Array.from({ length: 5 }, () => decide(0.1, id))).size).toBe(1);
  });
});

describe('withoutUrlQueries', () => {
  it('cuts the query string and fragment of paths and absolute URLs', () => {
    expect(withoutUrlQueries('/api/vocabulary?q=resilient&sort=word')).toBe('/api/vocabulary');
    expect(withoutUrlQueries('fetch GET https://api.example.com/v1/users?email=a%40b.c')).toBe(
      'fetch GET https://api.example.com/v1/users',
    );
    expect(withoutUrlQueries('https://vexto.example/articles?q=moon#top')).toBe(
      'https://vexto.example/articles',
    );
  });

  it('leaves text without a query alone', () => {
    expect(withoutUrlQueries('GET /api/articles/[id]')).toBe('GET /api/articles/[id]');
    expect(withoutUrlQueries('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)')).toBe(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',
    );
    expect(withoutUrlQueries('Is it done?')).toBe('Is it done?');
  });
});

describe('urlQueryRemover', () => {
  it('cuts the queries out of the name and the attributes of an ending span', () => {
    const span = {
      name: 'fetch GET https://api.example.com/search?q=word',
      attributes: {
        'http.target': '/api/vocabulary?q=resilient',
        'http.referer': 'https://vexto.example/vocabulary?q=resilient',
        'http.method': 'GET',
        'http.status_code': 200,
      } as Record<string, unknown>,
      setAttribute(key: string, value: unknown) {
        this.attributes[key] = value;
        return this;
      },
      updateName(name: string) {
        this.name = name;
        return this;
      },
    };

    urlQueryRemover.onEnding?.(span as never);

    expect(span.name).toBe('fetch GET https://api.example.com/search');
    expect(span.attributes).toEqual({
      'http.target': '/api/vocabulary',
      'http.referer': 'https://vexto.example/vocabulary',
      'http.method': 'GET',
      'http.status_code': 200,
    });
  });
});
