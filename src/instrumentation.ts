// Runs once when a Next.js server starts, before it handles a request: it sets up tracing with
// @vercel/otel where something receives the spans (src/lib/tracing.ts).
import { registerOTel } from '@vercel/otel';
import { tracingConfiguration } from './lib/tracing.ts';

export function register() {
  const configuration = tracingConfiguration(process.env);
  if (configuration) {
    registerOTel(configuration);
  }
}
