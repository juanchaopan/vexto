import { describe, expect, it } from 'vitest';
import committed from '../../../config/observability.json' with { type: 'json' };
import { ConfigError } from './config-error.ts';
import { observabilityConfig, parseObservabilityConfig } from './observability-config.ts';

function problems(value: unknown) {
  try {
    parseObservabilityConfig(value);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('The configuration passed its validation.');
}

describe('observabilityConfig', () => {
  it('reads the committed service name and a low sample ratio', () => {
    expect(observabilityConfig).toEqual(committed);
    expect(observabilityConfig.traceSampleRatio).toBeLessThan(0.5);
  });
});

describe('parseObservabilityConfig', () => {
  it('refuses a service name that is not a plain lower-case name', () => {
    expect(problems({ ...committed, serviceName: 'Vexto Web' })).toMatch(
      /config\/observability\.json is invalid: serviceName/,
    );
  });

  it('refuses a sample ratio outside 0 to 1', () => {
    expect(problems({ ...committed, traceSampleRatio: -0.1 })).toContain('traceSampleRatio');
    expect(problems({ ...committed, traceSampleRatio: 2 })).toContain('traceSampleRatio');
  });

  it('refuses unknown fields', () => {
    expect(problems({ ...committed, exporter: 'otlp' })).toContain('config/observability.json');
  });
});
