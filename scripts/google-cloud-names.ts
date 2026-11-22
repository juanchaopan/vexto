// Prints the names the deployment job uses for a target's Google Cloud resources, as
// `name=value` lines for $GITHUB_OUTPUT, from the conventions in scripts/lib/google-cloud.ts.
// Usage: node scripts/google-cloud-names.ts
// Reads GCP_PROJECT_ID, GCP_REGION and COMMIT (the full SHA being deployed) from its environment.
//   registry    host of the target's Artifact Registry
//   repository  the worker image without a tag
//   image       the worker image of the commit
import { parseGoogleCloudTarget, workerImage } from './lib/google-cloud.ts';

try {
  const target = parseGoogleCloudTarget({
    projectId: process.env.GCP_PROJECT_ID,
    region: process.env.GCP_REGION,
  });
  const image = workerImage(target, process.env.COMMIT ?? '');
  const repository = image.slice(0, image.lastIndexOf(':'));
  console.log(`registry=${target.region}-docker.pkg.dev`);
  console.log(`repository=${repository}`);
  console.log(`image=${image}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
