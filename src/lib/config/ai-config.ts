// How the AI is called (.docs/decisions/0004-ai-provider.md and .docs/design/rules.md, AI 查词):
// the provider and model of config/ai.json with the parameters of every call. Only the server
// reads it; the API key comes from the OPENAI_API_KEY runtime value, never from a file.
import { z } from 'zod';
import raw from '../../../config/ai.json' with { type: 'json' };
import { parseConfig } from './config-error.ts';

const plainName = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'must be a plain lower-case name');

const aiShape = z.strictObject({
  /** Recorded on usage records; `openai` is the only provider the code calls. */
  provider: z.literal('openai'),
  /** The model every lookup, example and option call uses, such as `gpt-6-luna`. */
  model: plainName,
  /** How long one call may take before it counts as timed out. */
  requestTimeoutMs: z.number().int().min(1000).max(60_000),
  /** The most output tokens a call may use, reasoning included. */
  maxOutputTokens: z.number().int().min(200).max(32_000),
  /** How much the model reasons before it answers. */
  reasoningEffort: z.enum(['none', 'low', 'medium', 'high']),
});

export type AiConfig = z.infer<typeof aiShape>;

export function parseAiConfig(value: unknown): AiConfig {
  return parseConfig('config/ai.json', aiShape, value);
}

/** The committed AI configuration, validated when this module loads. */
export const aiConfig: AiConfig = parseAiConfig(raw);
