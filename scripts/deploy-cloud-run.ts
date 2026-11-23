// Points the Cloud Run job and services of a target at the worker image of one commit, creating
// them on the first deployment, with the settings in scripts/lib/cloud-run.ts.
//
// Usage: node scripts/deploy-cloud-run.ts
// Reads from its environment:
//   GCP_PROJECT_ID, GCP_REGION  the target's Google Cloud project and region
//   COMMIT                      full SHA of the commit whose image was pushed
//   each name in cloudRunVariables (scripts/lib/runtime-env.ts), from the environment's
//   variable of that name, with its <name>_STORED_AS_SECRET flag; a value under the wrong kind
//   or a name the step does not pass stops the deployment before anything changes
// gcloud must be logged in with an account that may deploy to Cloud Run and act as the
// resources' service accounts. The secrets the resources read are referenced by name; their
// values are in Secret Manager (scripts/sync-secret-manager.ts).
import { cloudRunDeployments, deployArgs } from './lib/cloud-run.ts';
import { gcloud } from './lib/gcloud.ts';
import { MODEL_MOUNT_PATH, parseGoogleCloudTarget, workerImage } from './lib/google-cloud.ts';
import { cloudRunVariables, planSync } from './lib/runtime-env.ts';
import { modelVersionPath, readSpeechModel } from './lib/speech-model.ts';

try {
  const plan = planSync(process.env, cloudRunVariables);
  if (plan.errors.length > 0) {
    throw new Error(plan.errors.join('\n'));
  }
  const target = parseGoogleCloudTarget({
    projectId: process.env.GCP_PROJECT_ID,
    region: process.env.GCP_REGION,
  });
  const input = {
    target,
    image: workerImage(target, process.env.COMMIT ?? ''),
    variables: plan.upload,
    modelDir: `${MODEL_MOUNT_PATH}/${modelVersionPath(readSpeechModel())}`,
  };
  // Every argument list is built first, so a bad value stops the deployment before any change.
  const deployments = cloudRunDeployments.map((deployment) => ({
    resource: deployment.resource,
    args: deployArgs(deployment, input),
  }));
  if (plan.skipped.length > 0) {
    console.log(
      `No value in the GitHub environment, left as they are: ${plan.skipped.join(', ')}.`,
    );
  }
  for (const { resource, args } of deployments) {
    console.log(`Deploying ${resource}: gcloud ${args.join(' ')}`);
    const { code } = await gcloud(args);
    if (code !== 0) {
      throw new Error(`Deploying ${resource} failed (gcloud exited with ${code}).`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
