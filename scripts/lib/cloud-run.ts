// How each Cloud Run resource of a target is deployed from the one worker image: its entry, its
// limits (.docs/architecture.md, Google Cloud 的费用) and the runtime values it reads.
// deployArgs() gives the `gcloud run` arguments that create the resource or update it to a new
// image. Every deployment sets every setting again, so a resource changed by hand returns to
// these values; environment variables and secrets are updated by name, so a value not set in the
// GitHub environment keeps the one Cloud Run has.
import {
  MODEL_MOUNT_PATH,
  modelBucket,
  runtimeServiceAccount,
  type CloudRunResource,
  type GoogleCloudTarget,
} from './google-cloud.ts';
import {
  cloudRunSecrets,
  type RuntimeReader,
  type RuntimeValueWithContent,
} from './runtime-env.ts';

export type CloudRunDeployment = {
  resource: CloudRunResource;
  kind: 'job' | 'service';
  /** The entry Node runs, given to the image's `node` entrypoint as its argument. */
  entry: string;
  /** Whose runtime values the resource gets; the billing guard reads none. */
  reader?: Extract<RuntimeReader, 'collect' | 'tts'>;
  cpu: string;
  memory: string;
  /** Whether the model bucket is mounted and MODEL_DIR set. */
  model: boolean;
  /** Settings of this resource only. */
  settings: readonly string[];
};

// Services allow no unauthenticated calls: only accounts with Run Invoker on the service may call.
const privateService = ['--min-instances=0', '--max-instances=1', '--no-allow-unauthenticated'];

export const cloudRunDeployments: readonly CloudRunDeployment[] = [
  {
    // One task at a time, at most an hour, and no retry: the next scheduled run carries on.
    resource: 'vexto-collect',
    kind: 'job',
    entry: 'src/worker/collect.ts',
    reader: 'collect',
    cpu: '2',
    memory: '2Gi',
    model: true,
    settings: ['--tasks=1', '--parallelism=1', '--max-retries=0', '--task-timeout=3600s'],
  },
  {
    // The model takes about 400 MB on disk and somewhat more once loaded, so 2 GiB leaves room
    // for the inference and lame; one vCPU synthesizes a word or a sentence in seconds. With
    // 1 vCPU and 2 GiB the free 180,000 vCPU-seconds and 360,000 GiB-seconds of Cloud Run
    // services both last 50 instance-hours a month. Cloud Storage volumes need the second
    // generation execution environment.
    resource: 'vexto-tts',
    kind: 'service',
    entry: 'src/worker/tts.ts',
    reader: 'tts',
    cpu: '1',
    memory: '2Gi',
    model: true,
    settings: [...privateService, '--execution-environment=gen2'],
  },
  {
    // A small HTTP handler that makes one API call per notification.
    resource: 'vexto-billing-guard',
    kind: 'service',
    entry: 'src/worker/billing-guard.ts',
    cpu: '1',
    memory: '256Mi',
    model: false,
    settings: privateService,
  },
];

/** Separator of gcloud's `^<separator>^` list syntax, which no value may contain. */
const ENV_SEPARATOR = '|';

function envVarsArg(values: readonly [string, string][]) {
  for (const [name, value] of values) {
    if (value.includes(ENV_SEPARATOR) || /[\r\n]/.test(value)) {
      throw new Error(`${name} must not contain "${ENV_SEPARATOR}" or a line break.`);
    }
  }
  const list = values.map(([name, value]) => `${name}=${value}`).join(ENV_SEPARATOR);
  return `--update-env-vars=^${ENV_SEPARATOR}^${list}`;
}

function valueArgs(
  deployment: CloudRunDeployment,
  variables: readonly RuntimeValueWithContent[],
  modelDir: string,
) {
  const { reader } = deployment;
  if (!reader) {
    return [];
  }
  const env: [string, string][] = variables
    .filter((variable) => variable.readers.includes(reader))
    .map((variable) => [variable.name, variable.value]);
  if (deployment.model) {
    env.push(['MODEL_DIR', modelDir]);
  }
  const secrets = cloudRunSecrets
    .filter((secret) => secret.readers.includes(reader))
    .map(({ name }) => `${name}=${name}:latest`);
  return [
    ...(env.length > 0 ? [envVarsArg(env)] : []),
    ...(secrets.length > 0 ? [`--update-secrets=${secrets.join(',')}`] : []),
  ];
}

function modelVolumeArgs(projectId: string) {
  return [
    '--clear-volumes',
    `--add-volume=name=models,type=cloud-storage,bucket=${modelBucket(projectId)},readonly=true`,
    '--clear-volume-mounts',
    `--add-volume-mount=volume=models,mount-path=${MODEL_MOUNT_PATH}`,
  ];
}

export type DeployInput = {
  target: GoogleCloudTarget;
  image: string;
  /** The Cloud Run variables that have a value in the GitHub environment. */
  variables: readonly RuntimeValueWithContent[];
  /** MODEL_DIR: the model's directory inside the mounted bucket. */
  modelDir: string;
};

export function deployArgs(deployment: CloudRunDeployment, input: DeployInput): string[] {
  const { projectId, region } = input.target;
  const command = deployment.kind === 'job' ? ['run', 'jobs', 'deploy'] : ['run', 'deploy'];
  return [
    ...command,
    deployment.resource,
    `--image=${input.image}`,
    `--project=${projectId}`,
    `--region=${region}`,
    `--service-account=${runtimeServiceAccount(projectId, deployment.resource)}`,
    `--args=${deployment.entry}`,
    `--cpu=${deployment.cpu}`,
    `--memory=${deployment.memory}`,
    ...deployment.settings,
    ...(deployment.model ? modelVolumeArgs(projectId) : []),
    ...valueArgs(deployment, input.variables, input.modelDir),
    '--quiet',
  ];
}
