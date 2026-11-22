// Names of a deployment target's Google Cloud resources. They all follow from the target's
// project ID and region (the GitHub environment's GCP_PROJECT_ID and GCP_REGION), so the
// environment needs no variable per resource. The resources are created once, outside the
// deployment, under exactly these names; AGENTS.md lists the same conventions.
import { z } from 'zod';

const projectIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'must be a Google Cloud project ID');
const regionSchema = z
  .string()
  .regex(/^[a-z]+-[a-z]+[0-9]+$/, 'must be a region such as us-central1');

/** Artifact Registry repository of the Cloud Run image. */
export const ARTIFACT_REPOSITORY = 'vexto';

/** Image name of the one image the Cloud Run job and services run. */
export const WORKER_IMAGE = 'worker';

/** Where the model bucket is mounted in the Cloud Run job and the speech service. */
export const MODEL_MOUNT_PATH = '/models';

/** The Cloud Run job and services, each with its own runtime service account of the same name. */
export const CLOUD_RUN_RESOURCES = ['vexto-collect', 'vexto-tts', 'vexto-billing-guard'] as const;

export type CloudRunResource = (typeof CLOUD_RUN_RESOURCES)[number];

export type GoogleCloudTarget = { projectId: string; region: string };

function parseWith<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) =>
      [issue.path.join('.'), issue.message].filter(Boolean).join(' '),
    );
    throw new Error(`${what} is invalid: ${issues.join('; ')}.`);
  }
  return result.data;
}

export function parseProjectId(value: string | undefined): string {
  return parseWith(projectIdSchema, value, 'The Google Cloud project ID');
}

export function parseGoogleCloudTarget(value: {
  projectId: string | undefined;
  region: string | undefined;
}): GoogleCloudTarget {
  return parseWith(
    z.object({ projectId: projectIdSchema, region: regionSchema }),
    value,
    'The Google Cloud target',
  );
}

/** Bucket the speech model is copied to: <project>-models. */
export function modelBucket(projectId: string) {
  return `${projectId}-models`;
}

/** Service account a Cloud Run resource runs as: <resource>@<project>.iam.gserviceaccount.com. */
export function runtimeServiceAccount(projectId: string, resource: CloudRunResource) {
  return `${resource}@${projectId}.iam.gserviceaccount.com`;
}

/** <region>-docker.pkg.dev/<project>/vexto/worker:<commit>, the image of one commit. */
export function workerImage({ projectId, region }: GoogleCloudTarget, commit: string) {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('The image tag must be a full commit SHA.');
  }
  return `${region}-docker.pkg.dev/${projectId}/${ARTIFACT_REPOSITORY}/${WORKER_IMAGE}:${commit}`;
}
