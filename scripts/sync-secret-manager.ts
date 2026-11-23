// Copies the secrets the Cloud Run job and services read (cloudRunSecrets in
// scripts/lib/runtime-env.ts) from a GitHub environment into the target's Secret Manager, where
// Cloud Run reads their `latest` version. A secret whose value has not changed gets no new
// version; afterwards every secret keeps only its newest version. A name with no value in the
// GitHub environment keeps the version Secret Manager has.
//
// Usage: node scripts/sync-secret-manager.ts
// Reads from its environment:
//   each listed name          the value, from the environment's secret of that name
//   <name>_STORED_AS_VARIABLE true when the name is also set as a variable, which stops the sync
//   GCP_PROJECT_ID            the target's Google Cloud project
// gcloud must be logged in with an account that may read, add and destroy the secrets' versions.
// Each value reaches gcloud on standard input only: the values and their flags are removed from
// gcloud's environment, and neither a value nor the current version is printed.
import { gcloud } from './lib/gcloud.ts';
import { parseProjectId } from './lib/google-cloud.ts';
import { cliEnv, cloudRunSecrets, planSync } from './lib/runtime-env.ts';
import {
  accessLatestArgs,
  addVersionArgs,
  destroyVersionArgs,
  listVersionsArgs,
  needsNewVersion,
  versionsToDestroy,
} from './lib/secret-manager.ts';

const env = cliEnv(process.env, cloudRunSecrets);

async function currentValue(name: string, projectId: string) {
  const { code, output } = await gcloud(accessLatestArgs(name, projectId), {
    env,
    captureOutput: true,
  });
  return code === 0 ? output : undefined;
}

async function mustRun(args: string[], what: string, input?: string) {
  const { code } = await gcloud(args, { env, input });
  if (code !== 0) {
    throw new Error(`${what} failed (gcloud exited with ${code}).`);
  }
}

async function writeIfChanged(name: string, value: string, projectId: string) {
  if (!needsNewVersion(await currentValue(name, projectId), value)) {
    console.log(`${name} is unchanged; no new version.`);
    return;
  }
  await mustRun(addVersionArgs(name, projectId), `Adding a version of ${name}`, value);
  console.log(`${name} has a new version.`);
}

async function keepOnlyNewestVersion(name: string, projectId: string) {
  const { code, output } = await gcloud(listVersionsArgs(name, projectId), {
    env,
    captureOutput: true,
  });
  if (code !== 0) {
    throw new Error(`Listing the versions of ${name} failed (gcloud exited with ${code}).`);
  }
  for (const version of versionsToDestroy(output)) {
    await mustRun(
      destroyVersionArgs(name, version, projectId),
      `Destroying version ${version} of ${name}`,
    );
    console.log(`Destroyed the older version ${version} of ${name}.`);
  }
}

const plan = planSync(process.env, cloudRunSecrets);

try {
  if (plan.errors.length > 0) {
    throw new Error(plan.errors.join('\n'));
  }
  const projectId = parseProjectId(process.env.GCP_PROJECT_ID);
  for (const { name, value } of plan.upload) {
    await writeIfChanged(name, value, projectId);
  }
  for (const { name } of cloudRunSecrets) {
    await keepOnlyNewestVersion(name, projectId);
  }
  if (plan.skipped.length > 0) {
    console.log(
      `No value in the GitHub environment, left as they are: ${plan.skipped.join(', ')}.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
