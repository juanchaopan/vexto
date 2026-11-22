import { describe, expect, it } from 'vitest';
import {
  envAddArgs,
  parseContext,
  planSync,
  runtimeValues,
  type RuntimeValue,
} from './runtime-env.ts';

const values: RuntimeValue[] = [
  { name: 'DB_URL', kind: 'secret' },
  { name: 'API_KEY', kind: 'secret' },
  { name: 'BUCKET', kind: 'variable' },
  { name: 'REGION', kind: 'variable' },
];

describe('runtimeValues', () => {
  it('lists every name once', () => {
    const names = runtimeValues.map((value) => value.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps browser-visible values out of the secrets', () => {
    const publicSecrets = runtimeValues.filter(
      (value) => value.kind === 'secret' && value.name.startsWith('NEXT_PUBLIC_'),
    );
    expect(publicSecrets).toEqual([]);
  });
});

describe('parseContext', () => {
  it('reads a JSON object', () => {
    expect(parseContext('{"A":"1","github_token":"x"}', 'X')).toEqual({
      A: '1',
      github_token: 'x',
    });
  });

  it('treats a missing or blank context as empty', () => {
    expect(parseContext(undefined, 'X')).toEqual({});
    expect(parseContext('  ', 'X')).toEqual({});
  });

  it('rejects JSON that is not an object', () => {
    expect(() => parseContext('[]', 'ENVIRONMENT_VARS')).toThrow('ENVIRONMENT_VARS');
    expect(() => parseContext('null', 'ENVIRONMENT_VARS')).toThrow('ENVIRONMENT_VARS');
  });
});

describe('planSync', () => {
  it('uploads the values that are set, in list order, and skips the rest', () => {
    const plan = planSync(
      { API_KEY: 'k', DB_URL: 'postgres://x', github_token: 't', OTHER: 'o' },
      { REGION: '', BUCKET: 'b' },
      values,
    );
    expect(plan).toEqual({
      upload: [
        { name: 'DB_URL', kind: 'secret', value: 'postgres://x' },
        { name: 'API_KEY', kind: 'secret', value: 'k' },
        { name: 'BUCKET', kind: 'variable', value: 'b' },
      ],
      skipped: ['REGION'],
      errors: [],
    });
  });

  it('stops when a secret is stored as a variable or a variable as a secret', () => {
    const plan = planSync({ BUCKET: 'b' }, { DB_URL: 'postgres://x' }, values);
    expect(plan.upload).toEqual([]);
    expect(plan.errors).toEqual([
      'DB_URL is a secret; store it in the GitHub environment as an environment secret.',
      'BUCKET is a variable; store it in the GitHub environment as an environment variable.',
    ]);
  });

  it('skips everything when the environment holds nothing', () => {
    const plan = planSync({}, {}, values);
    expect(plan.upload).toEqual([]);
    expect(plan.skipped).toEqual(['DB_URL', 'API_KEY', 'BUCKET', 'REGION']);
  });
});

describe('envAddArgs', () => {
  it('overwrites the Production value, as Sensitive for a secret', () => {
    expect(envAddArgs('DB_URL', 'secret')).toEqual([
      'env',
      'add',
      'DB_URL',
      '--environment',
      'production',
      '--force',
      '--yes',
      '--sensitive',
    ]);
  });

  it('stores a variable as a plain value', () => {
    expect(envAddArgs('BUCKET', 'variable').at(-1)).toBe('--no-sensitive');
  });
});
