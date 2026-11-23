// The speech model the Cloud Run job and service load, as written in config/speech-model.json:
// a Hugging Face repository pinned to one revision, and the files the Node.js inference needs,
// each with its size and SHA-256 checksum. The same configuration places the files in the local
// download directory and in the model bucket, both under <name>/<revision>/, so a new revision
// sits next to the old one and switching is a change of this file.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { repoRoot } from './node-tools.ts';

// Every value becomes part of a path, a URL or a gcloud command line, so each is limited to
// plain characters and no file may leave the model's directory.
const plainName = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'must be a plain lower-case name');
const modelFile = z.strictObject({
  path: z
    .string()
    .regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.[a-z]+$/, 'must be a relative file path')
    .refine((value) => !value.split('/').includes('..'), 'must stay inside the model directory'),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 checksum in hex'),
});
const speechModelSchema = z.strictObject({
  name: plainName,
  repository: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'must be <owner>/<name>'),
  revision: z.string().regex(/^[0-9a-f]{40}$/, 'must be a full commit SHA'),
  files: z.array(modelFile).min(1),
});

export type SpeechModel = z.infer<typeof speechModelSchema>;
export type ModelFile = SpeechModel['files'][number];

export const speechModelConfig = path.join(repoRoot, 'config', 'speech-model.json');

/** Directory the files are downloaded to; .models/ is not committed. */
export const localModelsDir = path.join(repoRoot, '.models');

export function parseSpeechModel(json: string): SpeechModel {
  const result = speechModelSchema.safeParse(JSON.parse(json));
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
      .join('; ');
    throw new Error(`config/speech-model.json is invalid: ${issues}.`);
  }
  return result.data;
}

export function readSpeechModel(): SpeechModel {
  return parseSpeechModel(readFileSync(speechModelConfig, 'utf8'));
}

/** <name>/<revision>, the model's directory both locally and in the bucket. */
export function modelVersionPath(model: SpeechModel) {
  return `${model.name}/${model.revision}`;
}

export function localModelDir(model: SpeechModel) {
  return path.join(localModelsDir, model.name, model.revision);
}

export function downloadUrl(model: SpeechModel, file: ModelFile) {
  return `https://huggingface.co/${model.repository}/resolve/${model.revision}/${file.path}`;
}

/** SHA-256 of a file in hex, read as a stream so large model files are not held in memory. */
export async function sha256OfFile(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

/** Whether the file at that path exists and matches its recorded checksum. */
export async function matchesChecksum(filePath: string, file: ModelFile) {
  return existsSync(filePath) && (await sha256OfFile(filePath)) === file.sha256;
}
