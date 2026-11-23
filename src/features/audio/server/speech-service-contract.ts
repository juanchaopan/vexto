// The request and answer of the speech service's `POST /synthesize` (.docs/design/interfaces.md,
// 朗读服务 vexto-tts). The service checks requests with it and the web application checks the
// answers, so both ends read the same contract.
import { z } from 'zod';
import {
  isSpeechServiceKey,
  normalizeSpeechText,
  SPEECH_TEXT_MAX_LENGTH,
} from '../domain/audio-asset.ts';

const versionField = z.string().min(1).max(100);

export const speechRequestSchema = z.strictObject({
  /** The object to write: `speech/<UUID>.mp3`, or `smoke/check.mp3` for the smoke test. */
  key: z.string().refine(isSpeechServiceKey, 'must be speech/<UUID>.mp3 or smoke/check.mp3'),
  /** Normalized speech text of 1 to 300 characters. */
  text: z
    .string()
    .min(1)
    .max(SPEECH_TEXT_MAX_LENGTH)
    .refine((text) => normalizeSpeechText(text) === text, 'must be normalized speech text'),
  voice: versionField,
  modelRevision: versionField,
  encodingVersion: versionField,
});

export type SpeechRequest = z.infer<typeof speechRequestSchema>;

export const speechAnswerSchema = z.object({
  key: z.string(),
  byteSize: z.int().positive(),
  durationMs: z.int().positive(),
  usage: z.object({ cpuMs: z.int().nonnegative() }),
});

export type SpeechAnswer = z.infer<typeof speechAnswerSchema>;
