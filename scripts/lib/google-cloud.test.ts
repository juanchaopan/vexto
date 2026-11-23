import { describe, expect, it } from 'vitest';
import {
  modelBucket,
  parseGoogleCloudTarget,
  parseProjectId,
  runtimeServiceAccount,
  workerImage,
} from './google-cloud.ts';

const target = { projectId: 'vexto-staging', region: 'us-central1' };
const commit = '7a176e0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f';

describe('parseGoogleCloudTarget', () => {
  it('accepts a project ID and a region', () => {
    expect(parseGoogleCloudTarget(target)).toEqual(target);
  });

  it('refuses missing or malformed values', () => {
    expect(() => parseGoogleCloudTarget({ projectId: undefined, region: 'us-central1' })).toThrow(
      'projectId',
    );
    expect(() => parseGoogleCloudTarget({ projectId: 'vexto-staging', region: 'central' })).toThrow(
      'region must be a region',
    );
    expect(() => parseProjectId('Vexto Staging')).toThrow('project ID is invalid');
    expect(() => parseProjectId('a-b')).toThrow();
  });
});

describe('resource names', () => {
  it('derives the model bucket from the project', () => {
    expect(modelBucket('vexto-staging')).toBe('vexto-staging-models');
  });

  it('gives each Cloud Run resource the service account of its own name', () => {
    expect(runtimeServiceAccount('vexto-staging', 'vexto-tts')).toBe(
      'vexto-tts@vexto-staging.iam.gserviceaccount.com',
    );
  });

  it('tags the image with the commit it was built from', () => {
    expect(workerImage(target, commit)).toBe(
      `us-central1-docker.pkg.dev/vexto-staging/vexto/worker:${commit}`,
    );
    expect(() => workerImage(target, 'latest')).toThrow('full commit SHA');
  });
});
