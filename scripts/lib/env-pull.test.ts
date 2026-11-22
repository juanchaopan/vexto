import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { envPullCommands, parseEnvPullConfig, resolveEnvPullTarget } from './env-pull.ts';
import { repoRoot } from './node-tools.ts';

const config = { project: 'app-staging', scope: 'team-a' };

describe('parseEnvPullConfig', () => {
  it('reads the project and the scope', () => {
    expect(parseEnvPullConfig('{"project":"app-staging","scope":"team_AB12"}')).toEqual({
      project: 'app-staging',
      scope: 'team_AB12',
    });
  });

  it('rejects a configuration that is not an object or misses a name', () => {
    expect(() => parseEnvPullConfig('[]')).toThrow(/JSON object/);
    expect(() => parseEnvPullConfig('{"project":"app"}')).toThrow(/scope must be/);
    expect(() => parseEnvPullConfig('{"project":3,"scope":"team"}')).toThrow(/project must be/);
  });

  it('rejects names a shell would read as more than a name', () => {
    expect(() => parseEnvPullConfig('{"project":"app & calc","scope":"team"}')).toThrow(
      /project must be/,
    );
    expect(() => parseEnvPullConfig('{"project":"app","scope":"-team"}')).toThrow(/scope must be/);
  });

  it('accepts the repository configuration', () => {
    const text = readFileSync(path.join(repoRoot, 'scripts', 'env-pull.json'), 'utf8');
    expect(() => parseEnvPullConfig(text)).not.toThrow();
  });
});

describe('resolveEnvPullTarget', () => {
  it('uses the configuration when the environment sets nothing', () => {
    expect(resolveEnvPullTarget(config, {})).toEqual(config);
  });

  it('treats empty environment values as unset', () => {
    expect(resolveEnvPullTarget(config, { VERCEL_PROJECT: '', VERCEL_SCOPE: '' })).toEqual(config);
  });

  it('lets the environment override each name on its own', () => {
    expect(resolveEnvPullTarget(config, { VERCEL_PROJECT: 'other' })).toEqual({
      project: 'other',
      scope: 'team-a',
    });
    expect(resolveEnvPullTarget(config, { VERCEL_SCOPE: 'team-b' })).toEqual({
      project: 'app-staging',
      scope: 'team-b',
    });
  });

  it('checks the overriding names', () => {
    expect(() => resolveEnvPullTarget(config, { VERCEL_SCOPE: 'a;b' })).toThrow(/VERCEL_SCOPE/);
  });
});

describe('envPullCommands', () => {
  it('links the project, then pulls its Development values into .env.local', () => {
    expect(envPullCommands('1.2.3', config)).toEqual([
      ['dlx', 'vercel@1.2.3', 'link', '--yes', '--project', 'app-staging', '--scope', 'team-a'],
      ['dlx', 'vercel@1.2.3', 'env', 'pull', '.env.local', '--environment', 'development', '--yes'],
    ]);
  });

  it('needs an exact CLI version', () => {
    expect(() => envPullCommands(undefined, config)).toThrow(/VERCEL_CLI_VERSION/);
    expect(() => envPullCommands('latest', config)).toThrow(/VERCEL_CLI_VERSION/);
  });
});
