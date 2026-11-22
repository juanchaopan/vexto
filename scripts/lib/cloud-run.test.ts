import { describe, expect, it } from 'vitest';
import { cloudRunDeployments, deployArgs, type CloudRunDeployment } from './cloud-run.ts';
import { cloudRunVariables } from './runtime-env.ts';

const commit = '7a176e0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f';
const image = `us-central1-docker.pkg.dev/vexto-staging/vexto/worker:${commit}`;
const modelDir = '/models/supertonic-3/aafc6e32416a594460b32413efc49d7fe4ce6d46';
const values: Record<string, string> = {
  S3_ENDPOINT: 'https://storage.example.com',
  S3_REGION: 'us-east-2',
  S3_BUCKET: 'audio',
};
const input = {
  target: { projectId: 'vexto-staging', region: 'us-central1' },
  image,
  variables: cloudRunVariables.map((variable) => ({ ...variable, value: values[variable.name] })),
  modelDir,
};

function deployment(resource: CloudRunDeployment['resource']) {
  const found = cloudRunDeployments.find((candidate) => candidate.resource === resource);
  if (!found) {
    throw new Error(`No deployment for ${resource}`);
  }
  return found;
}

describe('deployArgs', () => {
  it('deploys the collection job with its limits, the model and its values', () => {
    expect(deployArgs(deployment('vexto-collect'), input)).toEqual([
      'run',
      'jobs',
      'deploy',
      'vexto-collect',
      `--image=${image}`,
      '--project=vexto-staging',
      '--region=us-central1',
      '--service-account=vexto-collect@vexto-staging.iam.gserviceaccount.com',
      '--args=src/worker/collect.ts',
      '--cpu=2',
      '--memory=2Gi',
      '--tasks=1',
      '--parallelism=1',
      '--max-retries=0',
      '--task-timeout=3600s',
      '--clear-volumes',
      '--add-volume=name=models,type=cloud-storage,bucket=vexto-staging-models,readonly=true',
      '--clear-volume-mounts',
      '--add-volume-mount=volume=models,mount-path=/models',
      '--update-env-vars=^|^S3_ENDPOINT=https://storage.example.com|S3_REGION=us-east-2|' +
        `S3_BUCKET=audio|MODEL_DIR=${modelDir}`,
      '--update-secrets=DATABASE_URL=DATABASE_URL:latest,S3_ACCESS_KEY_ID=S3_ACCESS_KEY_ID:latest,' +
        'S3_SECRET_ACCESS_KEY=S3_SECRET_ACCESS_KEY:latest',
      '--quiet',
    ]);
  });

  it('keeps the speech service private, at most one instance, without the database', () => {
    const args = deployArgs(deployment('vexto-tts'), input);

    expect(args.slice(0, 3)).toEqual(['run', 'deploy', 'vexto-tts']);
    expect(args).toEqual(
      expect.arrayContaining([
        '--service-account=vexto-tts@vexto-staging.iam.gserviceaccount.com',
        '--args=src/worker/tts.ts',
        '--min-instances=0',
        '--max-instances=1',
        '--no-allow-unauthenticated',
        '--execution-environment=gen2',
        '--add-volume-mount=volume=models,mount-path=/models',
        '--update-secrets=S3_ACCESS_KEY_ID=S3_ACCESS_KEY_ID:latest,' +
          'S3_SECRET_ACCESS_KEY=S3_SECRET_ACCESS_KEY:latest',
      ]),
    );
  });

  it('gives the billing guard no model and no runtime values', () => {
    const args = deployArgs(deployment('vexto-billing-guard'), input);

    expect(args).toEqual(
      expect.arrayContaining([
        '--service-account=vexto-billing-guard@vexto-staging.iam.gserviceaccount.com',
        '--args=src/worker/billing-guard.ts',
        '--max-instances=1',
        '--no-allow-unauthenticated',
      ]),
    );
    expect(args.filter((arg) => /volume|env-vars|secrets/.test(arg))).toEqual([]);
  });

  it('leaves out the variables that have no value', () => {
    const args = deployArgs(deployment('vexto-tts'), { ...input, variables: [] });

    expect(args).toContain(`--update-env-vars=^|^MODEL_DIR=${modelDir}`);
  });

  it('refuses a value that would break the list of environment variables', () => {
    const variables = [{ ...cloudRunVariables[0], value: 'https://a|b' }];

    expect(() => deployArgs(deployment('vexto-collect'), { ...input, variables })).toThrow(
      'S3_ENDPOINT must not contain',
    );
  });
});
