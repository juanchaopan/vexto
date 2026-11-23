// How the web application is traced (.docs/architecture.md, 观测): the service name its spans
// carry and the share of requests that are traced, kept low so tracing stays within Vercel's free
// tracing. Only the server reads it.
import { z } from 'zod';
import raw from '../../../config/observability.json' with { type: 'json' };
import { parseConfig } from './config-error.ts';

const observabilityShape = z.strictObject({
  /** The service name of every span, such as `vexto-web`. */
  serviceName: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'must be a plain lower-case name'),
  /** The share of requests traced, from 0 (none) to 1 (every request). */
  traceSampleRatio: z.number().min(0).max(1),
});

export type ObservabilityConfig = z.infer<typeof observabilityShape>;

export function parseObservabilityConfig(value: unknown): ObservabilityConfig {
  return parseConfig('config/observability.json', observabilityShape, value);
}

/** The committed observability configuration, validated when this module loads. */
export const observabilityConfig: ObservabilityConfig = parseObservabilityConfig(raw);
