// Tracing of the web application with @vercel/otel (.docs/architecture.md, 观测), set up by
// src/instrumentation.ts when a Next.js server starts.
//   - Spans are recorded only where something receives them: on Vercel, whose tracing collects
//     them, or where an OTLP endpoint is configured. Anywhere else, such as local development or
//     the end-to-end test container, tracing stays off and nothing is sent.
//   - A low share of requests is traced (config/observability.json), decided by the trace ID so
//     every span of a trace gets the same decision. OTEL_TRACES_SAMPLER, when set, decides
//     instead, as OpenTelemetry defines it.
//   - Query strings and fragments are cut from every URL in span names and attributes before a
//     span is exported, since search boxes put the words a person searches for there. The code
//     adds no attributes of its own, so no email address, selection or secret reaches a span.
import type { Configuration } from '@vercel/otel';
import { observabilityConfig, type ObservabilityConfig } from './config/observability-config.ts';

type Sampler = Exclude<NonNullable<Configuration['traceSampler']>, string>;
type SpanProcessor = Exclude<NonNullable<Configuration['spanProcessors']>[number], string>;
type EndingSpan = Parameters<NonNullable<SpanProcessor['onEnding']>>[0];

export type TracingEnv = Readonly<Record<string, string | undefined>>;

const isSet = (value: string | undefined) => value !== undefined && value.trim() !== '';

/** Whether something receives the spans: Vercel, or a configured OTLP endpoint. */
export function hasTraceReceiver(env: TracingEnv): boolean {
  return (
    env.VERCEL === '1' ||
    isSet(env.OTEL_EXPORTER_OTLP_ENDPOINT) ||
    isSet(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)
  );
}

/** Sampling decisions of OpenTelemetry's SamplingDecision. */
const NOT_RECORD = 0;
const RECORD_AND_SAMPLED = 2;

/**
 * Traces the given share of traces. The last 32 bits of the trace ID, which W3C trace IDs keep
 * random, are compared with the share, so every span of one trace is decided alike.
 */
export function traceIdRatioSampler(ratio: number): Sampler {
  const bound = Math.floor(ratio * 2 ** 32);
  return {
    shouldSample: (_context, traceId) => ({
      decision: Number.parseInt(traceId.slice(-8), 16) < bound ? RECORD_AND_SAMPLED : NOT_RECORD,
    }),
    toString: () => `TraceIdRatioSampler{${ratio}}`,
  };
}

/** An absolute URL or a path, followed by its query string or fragment. */
const urlWithQuery = /((?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s?#]*)[?#]\S*/gi;

/** The text with the query string and fragment of every URL or path in it cut off. */
export function withoutUrlQueries(text: string): string {
  return text.replace(urlWithQuery, '$1');
}

/**
 * Cuts the query strings out of a span while it ends, the last moment its name and attributes
 * can change; it is listed before the exporting processors, so they see the cut span.
 */
export const urlQueryRemover: SpanProcessor = {
  onStart: () => undefined,
  onEnding(span: EndingSpan) {
    for (const [key, value] of Object.entries(span.attributes)) {
      if (typeof value === 'string') {
        const cut = withoutUrlQueries(value);
        if (cut !== value) {
          span.setAttribute(key, cut);
        }
      }
    }
    const name = withoutUrlQueries(span.name);
    if (name !== span.name) {
      span.updateName(name);
    }
  },
  onEnd: () => undefined,
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

/** The @vercel/otel configuration, or null when nothing would receive the spans. */
export function tracingConfiguration(
  env: TracingEnv,
  config: ObservabilityConfig = observabilityConfig,
): Configuration | null {
  if (!hasTraceReceiver(env)) {
    return null;
  }
  return {
    serviceName: config.serviceName,
    traceSampler: isSet(env.OTEL_TRACES_SAMPLER)
      ? 'auto'
      : traceIdRatioSampler(config.traceSampleRatio),
    spanProcessors: [urlQueryRemover, 'auto'],
  };
}
