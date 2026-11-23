// Downloads the speech model in config/speech-model.json for local development, or copies the
// downloaded files to a target's model bucket.
// Usage:
//   node scripts/model.ts download
//     Downloads each file from Hugging Face at the pinned revision into
//     .models/<name>/<revision>/, checks its size and SHA-256, and keeps files already there that
//     match. A file that does not match is never kept.
//   node scripts/model.ts upload <project-id>
//     Checks the downloaded files again and copies them with gcloud to
//     gs://<project-id>-models/<name>/<revision>/, where the Cloud Run job and the speech service
//     mount them. gcloud checks each upload against the file's own checksum.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { gcloud } from './lib/gcloud.ts';
import { modelBucket, parseProjectId } from './lib/google-cloud.ts';
import {
  downloadUrl,
  localModelDir,
  matchesChecksum,
  modelVersionPath,
  readSpeechModel,
  type ModelFile,
  type SpeechModel,
} from './lib/speech-model.ts';

const usage = 'Usage: node scripts/model.ts download | upload <project-id>';

async function downloadFile(model: SpeechModel, file: ModelFile, target: string) {
  const response = await fetch(downloadUrl(model, file));
  if (!response.ok || !response.body) {
    throw new Error(`Downloading ${file.path} failed with HTTP ${response.status}.`);
  }
  const partial = `${target}.partial`;
  const hash = createHash('sha256');
  let size = 0;
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      size += chunk.length;
      done(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      measure,
      createWriteStream(partial),
    );
    const sha256 = hash.digest('hex');
    if (size !== file.size || sha256 !== file.sha256) {
      throw new Error(
        `${file.path} does not match config/speech-model.json: ` +
          `${size} bytes with SHA-256 ${sha256}, expected ${file.size} bytes with ${file.sha256}.`,
      );
    }
    await rename(partial, target);
  } finally {
    await rm(partial, { force: true });
  }
}

async function download(model: SpeechModel) {
  const dir = localModelDir(model);
  for (const file of model.files) {
    const target = path.join(dir, file.path);
    if (await matchesChecksum(target, file)) {
      console.log(`${file.path} is already downloaded and matches its checksum.`);
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    console.log(`Downloading ${file.path} (${file.size} bytes)...`);
    await downloadFile(model, file, target);
  }
  console.log(`The model files are in ${dir}.`);
}

async function upload(model: SpeechModel, projectId: string) {
  const dir = localModelDir(model);
  for (const file of model.files) {
    if (!(await matchesChecksum(path.join(dir, file.path), file))) {
      throw new Error(`${file.path} is missing or does not match; run \`task model-download\`.`);
    }
  }
  const prefix = `gs://${modelBucket(projectId)}/${modelVersionPath(model)}`;
  for (const file of model.files) {
    const destination = `${prefix}/${file.path}`;
    console.log(`Copying ${file.path} to ${destination}...`);
    const { code } = await gcloud(['storage', 'cp', file.path, destination], { cwd: dir });
    if (code !== 0) {
      throw new Error(`Copying ${file.path} failed (gcloud exited with ${code}).`);
    }
  }
}

const [command, ...rest] = process.argv.slice(2);

try {
  const model = readSpeechModel();
  if (command === 'download' && rest.length === 0) {
    await download(model);
  } else if (command === 'upload' && rest.length === 1) {
    await upload(model, parseProjectId(rest[0]));
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
