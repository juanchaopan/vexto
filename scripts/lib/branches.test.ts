import { describe, expect, it } from 'vitest';
import { parseBranch } from './branches.ts';

describe('parseBranch', () => {
  it.each([
    ['feature/12-word-lookup', 'feature', 12, 'word-lookup'],
    ['fix/3-empty-feed', 'fix', 3, 'empty-feed'],
    ['refactor/40-split-reader', 'refactor', 40, 'split-reader'],
    ['maintenance/1-set-up-the-project', 'maintenance', 1, 'set-up-the-project'],
  ])('reads the issue branch %s', (name, issueType, issue, shortName) => {
    expect(parseBranch(name)).toEqual({ kind: 'issue', name, issueType, issue, shortName });
  });

  it('reads a full ref name', () => {
    expect(parseBranch('refs/heads/fix/3-empty-feed')).toMatchObject({ kind: 'issue', issue: 3 });
  });

  it('reads a scratch branch', () => {
    expect(parseBranch('scratch/12-reader-layout')).toEqual({
      kind: 'scratch',
      name: 'scratch/12-reader-layout',
      issue: 12,
      shortName: 'reader-layout',
    });
  });

  it('reads a release branch with its version', () => {
    expect(parseBranch('release/1.4.0')).toEqual({
      kind: 'release',
      name: 'release/1.4.0',
      version: '1.4.0',
    });
    expect(parseBranch('release/2.0.0-rc.1')).toMatchObject({ version: '2.0.0-rc.1' });
  });

  it('reads Renovate branches and main', () => {
    expect(parseBranch('renovate/next-16.x')).toEqual({
      kind: 'renovate',
      name: 'renovate/next-16.x',
    });
    expect(parseBranch('renovate/lock-file-maintenance')).toMatchObject({ kind: 'renovate' });
    expect(parseBranch('main')).toEqual({ kind: 'main', name: 'main' });
  });

  it.each([
    'ops/7-rotate-keys',
    'spike/8-tts-hosting',
    'feature/word-lookup',
    'feature/0-word-lookup',
    'feature/12-Word_Lookup',
    'feature/12-',
    'scratch/reader',
    'release/next',
    'release/1.4',
    'renovate/',
    'master',
    'HEAD',
  ])('treats %s as unknown', (name) => {
    expect(parseBranch(name).kind).toBe('unknown');
  });
});
