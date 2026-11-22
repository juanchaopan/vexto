// Decisions and gcloud arguments for copying the Cloud Run secrets into a target's Secret
// Manager. Each secret is named like its runtime value and is created once, outside the
// deployment. A deployment adds a version only when the value differs from the current one, and
// destroys every older version, so each secret keeps exactly one active version (Secret
// Manager's free tier counts active versions). Values are compared by their SHA-256, so neither
// value is printed or kept beyond the comparison.
import { createHash } from 'node:crypto';

function sha256(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Whether a new version is needed: there is no readable current version, or it differs. */
export function needsNewVersion(current: string | undefined, value: string) {
  return current === undefined || sha256(current) !== sha256(value);
}

export function accessLatestArgs(name: string, projectId: string) {
  return ['secrets', 'versions', 'access', 'latest', `--secret=${name}`, `--project=${projectId}`];
}

/** The value itself is read from standard input. */
export function addVersionArgs(name: string, projectId: string) {
  return ['secrets', 'versions', 'add', name, '--data-file=-', `--project=${projectId}`];
}

export function listVersionsArgs(name: string, projectId: string) {
  return [
    'secrets',
    'versions',
    'list',
    name,
    `--project=${projectId}`,
    '--format=value(name.basename(),state)',
  ];
}

export function destroyVersionArgs(name: string, version: string, projectId: string) {
  return [
    'secrets',
    'versions',
    'destroy',
    version,
    `--secret=${name}`,
    `--project=${projectId}`,
    '--quiet',
  ];
}

/**
 * The versions to destroy, from the output of listVersionsArgs: every version not destroyed yet
 * except the newest, which is the one `latest` resolves to.
 */
export function versionsToDestroy(listOutput: string): string[] {
  const live = listOutput
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([version, state]) => /^\d+$/.test(version ?? '') && state !== 'DESTROYED')
    .map(([version]) => version)
    .sort((a, b) => Number(b) - Number(a));
  return live.slice(1);
}
