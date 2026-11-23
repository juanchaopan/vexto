import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  connectionStringArgs,
  neonTarget,
  parseNeonTargets,
  readConnectionString,
} from './neon-targets.ts';
import { repoRoot } from './node-tools.ts';

const staging = { projectId: 'calm-river-12345678', branchId: 'br-quiet-sun-a1b2c3d4' };

function configWith(target: Record<string, unknown>) {
  return JSON.stringify({ staging: target });
}

describe('parseNeonTargets', () => {
  it('reads each target with an optional database', () => {
    const json = JSON.stringify({
      staging: { ...staging, database: 'neondb' },
      production: { projectId: 'misty-lake-87654321', branchId: 'br-dark-moon-z9y8x7w6' },
    });
    expect(parseNeonTargets(json)).toEqual({
      staging: { ...staging, database: 'neondb' },
      production: { projectId: 'misty-lake-87654321', branchId: 'br-dark-moon-z9y8x7w6' },
    });
  });

  it('accepts the repository configuration', () => {
    const text = readFileSync(path.join(repoRoot, 'scripts', 'neon-targets.json'), 'utf8');
    expect(Object.keys(parseNeonTargets(text))).toEqual(['staging', 'production']);
  });

  it('rejects a configuration without targets or with unknown fields', () => {
    expect(() => parseNeonTargets('{}')).toThrow(/at least one target/);
    expect(() => parseNeonTargets('[]')).toThrow(/invalid/);
    expect(() => parseNeonTargets(configWith({ projectId: staging.projectId }))).toThrow(
      /staging\.branchId/,
    );
    expect(() => parseNeonTargets(configWith({ ...staging, role: 'owner' }))).toThrow(/invalid/);
  });

  it('rejects values a shell or the CLI would read as more than a name', () => {
    expect(() => parseNeonTargets(configWith({ ...staging, branchId: 'br-a & calc' }))).toThrow(
      /staging\.branchId must be a Neon ID/,
    );
    expect(() => parseNeonTargets(configWith({ ...staging, projectId: '-p' }))).toThrow(
      /projectId must be a Neon ID/,
    );
    expect(() => parseNeonTargets(configWith({ ...staging, database: '--psql' }))).toThrow(
      /database must be a database name/,
    );
    expect(() => parseNeonTargets(JSON.stringify({ 'Staging!': staging }))).toThrow(
      /Staging! Invalid key/,
    );
  });
});

describe('neonTarget', () => {
  const targets = { staging };

  it('finds a configured target', () => {
    expect(neonTarget(targets, 'staging')).toBe(staging);
  });

  it('lists the configured targets for an unknown name', () => {
    expect(() => neonTarget(targets, 'prod')).toThrow(
      'Unknown target "prod"; the configured targets are staging.',
    );
    expect(() => neonTarget(targets, 'constructor')).toThrow(/Unknown target/);
  });
});

describe('connectionStringArgs', () => {
  it('asks the pinned CLI for the branch’s direct connection string, without analytics', () => {
    expect(connectionStringArgs('9.9.3', { ...staging, database: 'neondb' })).toEqual([
      '--silent',
      'dlx',
      'neonctl@9.9.3',
      'connection-string',
      staging.branchId,
      '--project-id',
      staging.projectId,
      '--database-name',
      'neondb',
      '--no-analytics',
    ]);
  });

  it('leaves the database to the CLI when the target names none', () => {
    expect(connectionStringArgs('9.9.3', staging)).not.toContain('--database-name');
  });

  it('requires a plain version', () => {
    expect(() => connectionStringArgs(undefined, staging)).toThrow(/NEON_CLI_VERSION/);
    expect(() => connectionStringArgs('latest', staging)).toThrow(/NEON_CLI_VERSION/);
  });
});

describe('readConnectionString', () => {
  const url =
    'postgresql://neondb_owner:not-a-real-password@db.example.test/neondb?sslmode=require';

  it('returns the URL the CLI printed', () => {
    expect(readConnectionString(`${url}\n`)).toBe(url);
    expect(readConnectionString('postgres://u:p@localhost/db')).toBe('postgres://u:p@localhost/db');
  });

  it('rejects other output without repeating it', () => {
    for (const output of [
      '',
      `Logged in\n${url}\n`,
      'https://db.example.test/?not-a-real-password',
      'not-a-real-password',
    ]) {
      expect(() => readConnectionString(output)).toThrow(
        'The Neon CLI did not print a PostgreSQL connection string.',
      );
    }
  });
});
