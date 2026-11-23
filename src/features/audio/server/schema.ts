// Audio of articles, words and example sentences (.docs/design/data.md, 音频). Word and example
// audio is shared by everyone and found by cache_key; an article points at its audio row.
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { isOneOf, timestamptz, uuidPrimaryKey } from '../../../lib/db/columns.ts';
import { AUDIO_STATES, type AudioState } from '../domain/audio-asset.ts';

export const audioAssets = pgTable(
  'audio_assets',
  {
    id: uuidPrimaryKey(),
    cacheKey: text('cache_key').notNull(),
    objectKey: text('object_key').notNull().unique('audio_assets_object_key_key'),
    state: text('state').$type<AudioState>().notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }),
    durationMs: integer('duration_ms'),
    voice: text('voice').notNull(),
    modelRevision: text('model_revision').notNull(),
    encoding: text('encoding').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    retireAttempts: integer('retire_attempts').notNull().default(0),
  },
  (t) => [
    // Only one row per cache key may hold playable or pending audio; a retiring row keeps its
    // key until its object is gone, while a new row for the same text is already being made.
    uniqueIndex('audio_assets_cache_key_idx')
      .on(t.cacheKey)
      .where(sql`${t.state} <> 'retiring'`),
    index('audio_assets_state_created_at_id_idx').on(t.state, t.createdAt, t.id),
    check('audio_assets_state_check', isOneOf(t.state, AUDIO_STATES)),
    check('audio_assets_byte_size_check', sql`${t.byteSize} > 0`),
    check('audio_assets_duration_ms_check', sql`${t.durationMs} > 0`),
    check(
      'audio_assets_ready_check',
      sql`${t.state} <> 'ready' or (${t.byteSize} is not null and ${t.durationMs} is not null)`,
    ),
  ],
);
