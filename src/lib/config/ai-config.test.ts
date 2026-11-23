import { describe, expect, it } from 'vitest';
import committed from '../../../config/ai.json' with { type: 'json' };
import { aiConfig, parseAiConfig } from './ai-config.ts';
import { ConfigError } from './config-error.ts';

function problems(value: unknown) {
  try {
    parseAiConfig(value);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('The configuration passed its validation.');
}

describe('aiConfig', () => {
  it('reads the committed provider, model and call parameters', () => {
    expect(aiConfig).toEqual(committed);
    expect(aiConfig.provider).toBe('openai');
  });
});

describe('parseAiConfig', () => {
  it('refuses a provider the code does not call', () => {
    expect(problems({ ...committed, provider: 'other' })).toMatch(
      /config\/ai\.json is invalid: provider/,
    );
  });

  it('refuses a timeout outside one second to a minute', () => {
    expect(problems({ ...committed, requestTimeoutMs: 500 })).toContain('requestTimeoutMs');
    expect(problems({ ...committed, requestTimeoutMs: 120_000 })).toContain('requestTimeoutMs');
  });

  it('refuses an unknown reasoning effort and unknown fields', () => {
    expect(problems({ ...committed, reasoningEffort: 'extreme' })).toContain('reasoningEffort');
    expect(problems({ ...committed, apiKey: 'sk-test' })).toContain('config/ai.json');
  });
});
