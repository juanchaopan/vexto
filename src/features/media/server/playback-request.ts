// The body of `POST /api/media/playback`: one locator, its kind and the IDs that kind needs. Every
// kind is a strict object, so a field another kind uses, or any text, is invalid input.
import { z } from 'zod';
import type { PlaybackLocator } from '../domain/locator.ts';

const id = z.uuid();

export const playbackRequest = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('article'), articleId: id }),
  z.strictObject({ kind: z.literal('lookup-word'), lookupId: id }),
  z.strictObject({ kind: z.literal('lookup-example'), lookupId: id, exampleId: id }),
  z.strictObject({ kind: z.literal('card-word'), cardId: id }),
  z.strictObject({ kind: z.literal('card-example'), cardId: id, exampleId: id }),
]) satisfies z.ZodType<PlaybackLocator>;
