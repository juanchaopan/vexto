import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  downloadUrl,
  localModelDir,
  localModelsDir,
  matchesChecksum,
  modelVersionPath,
  parseSpeechModel,
  readSpeechModel,
  sha256OfFile,
} from './speech-model.ts';

const model = {
  name: 'supertonic-3',
  repository: 'supertone-oss-archive/supertonic-3',
  revision: 'aafc6e32416a594460b32413efc49d7fe4ce6d46',
  files: [
    {
      path: 'voice_styles/F1.json',
      size: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    },
  ],
};

describe('the committed speech model configuration', () => {
  const committed = readSpeechModel();

  it('pins the Hugging Face repository to a full revision', () => {
    expect(committed.repository).toBe('supertone-oss-archive/supertonic-3');
    expect(committed.revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it('lists the ONNX models and the configuration, indexer and F1 voice the inference reads', () => {
    expect(committed.files.map((file) => file.path).sort()).toEqual([
      'onnx/duration_predictor.onnx',
      'onnx/text_encoder.onnx',
      'onnx/tts.json',
      'onnx/unicode_indexer.json',
      'onnx/vector_estimator.onnx',
      'onnx/vocoder.onnx',
      'voice_styles/F1.json',
    ]);
  });
});

describe('parseSpeechModel', () => {
  it('reads a valid configuration', () => {
    expect(parseSpeechModel(JSON.stringify(model))).toEqual(model);
  });

  it('refuses paths that leave the model directory and values that are not plain', () => {
    const withFile = (file: object) => JSON.stringify({ ...model, files: [file] });
    const file = model.files[0];

    expect(() => parseSpeechModel(withFile({ ...file, path: '../escape.json' }))).toThrow(
      'files.0.path',
    );
    expect(() => parseSpeechModel(withFile({ ...file, path: '/etc/passwd.txt' }))).toThrow();
    expect(() => parseSpeechModel(withFile({ ...file, sha256: 'abc' }))).toThrow('SHA-256');
    expect(() => parseSpeechModel(JSON.stringify({ ...model, revision: 'main' }))).toThrow(
      'revision must be a full commit SHA',
    );
    expect(() => parseSpeechModel(JSON.stringify({ ...model, files: [] }))).toThrow('files');
  });
});

describe('model locations', () => {
  it('keeps each revision in its own directory, locally and in the bucket', () => {
    expect(modelVersionPath(model)).toBe('supertonic-3/aafc6e32416a594460b32413efc49d7fe4ce6d46');
    expect(localModelDir(model)).toBe(
      path.join(localModelsDir, 'supertonic-3', 'aafc6e32416a594460b32413efc49d7fe4ce6d46'),
    );
  });

  it('downloads each file at the pinned revision', () => {
    expect(downloadUrl(model, model.files[0])).toBe(
      'https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46/voice_styles/F1.json',
    );
  });
});

describe('checksums', () => {
  it('tells a matching file from a changed or missing one', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'speech-model-'));
    try {
      const file = path.join(dir, 'F1.json');
      await writeFile(file, 'abc');
      expect(await sha256OfFile(file)).toBe(model.files[0].sha256);
      expect(await matchesChecksum(file, model.files[0])).toBe(true);

      await writeFile(file, 'abd');
      expect(await matchesChecksum(file, model.files[0])).toBe(false);
      expect(await matchesChecksum(path.join(dir, 'missing.json'), model.files[0])).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
