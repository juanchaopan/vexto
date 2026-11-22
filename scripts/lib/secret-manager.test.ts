import { describe, expect, it } from 'vitest';
import {
  accessLatestArgs,
  addVersionArgs,
  destroyVersionArgs,
  needsNewVersion,
  versionsToDestroy,
} from './secret-manager.ts';

describe('needsNewVersion', () => {
  it('adds a version when there is none or the value differs', () => {
    expect(needsNewVersion(undefined, 'postgres://a')).toBe(true);
    expect(needsNewVersion('postgres://a', 'postgres://b')).toBe(true);
    expect(needsNewVersion('postgres://a', 'postgres://a\n')).toBe(true);
  });

  it('adds nothing when the value is unchanged', () => {
    expect(needsNewVersion('postgres://a', 'postgres://a')).toBe(false);
  });
});

describe('versionsToDestroy', () => {
  it('keeps only the newest version that is not destroyed yet', () => {
    const output = ['1\tDESTROYED', '3\tENABLED', '10\tENABLED', '2\tDISABLED', ''].join('\n');

    expect(versionsToDestroy(output)).toEqual(['3', '2']);
  });

  it('destroys nothing when one version or none is left', () => {
    expect(versionsToDestroy('4\tENABLED\n')).toEqual([]);
    expect(versionsToDestroy('')).toEqual([]);
  });
});

describe('gcloud arguments', () => {
  it('never put the value on the command line', () => {
    expect(addVersionArgs('DATABASE_URL', 'vexto-staging')).toEqual([
      'secrets',
      'versions',
      'add',
      'DATABASE_URL',
      '--data-file=-',
      '--project=vexto-staging',
    ]);
  });

  it('read the latest version and destroy one version of a secret', () => {
    expect(accessLatestArgs('S3_ACCESS_KEY_ID', 'vexto-staging')).toEqual([
      'secrets',
      'versions',
      'access',
      'latest',
      '--secret=S3_ACCESS_KEY_ID',
      '--project=vexto-staging',
    ]);
    expect(destroyVersionArgs('S3_ACCESS_KEY_ID', '3', 'vexto-staging')).toEqual([
      'secrets',
      'versions',
      'destroy',
      '3',
      '--secret=S3_ACCESS_KEY_ID',
      '--project=vexto-staging',
      '--quiet',
    ]);
  });
});
