// One row per actual call to the AI or to speech synthesis (.docs/design/data.md, usage_records).
// The project owner reads this table directly for usage and estimated cost; rows are kept for
// good, and a revoked member's rows keep their place without an owner.
import { bigint, check, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { isOneOf, timestamptz, uuidPrimaryKey } from '../../../lib/db/columns.ts';
import { members } from '../../account/index.ts';
import { USAGE_KINDS, USAGE_STATUSES, type UsageKind, type UsageStatus } from '../domain/usage.ts';

export const usageRecords = pgTable(
  'usage_records',
  {
    id: uuidPrimaryKey(),
    kind: text('kind').$type<UsageKind>().notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    engineRevision: text('engine_revision'),
    requestId: text('request_id'),
    status: text('status').$type<UsageStatus>().notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    audioMs: integer('audio_ms'),
    cpuMs: integer('cpu_ms'),
    byteCount: bigint('byte_count', { mode: 'number' }),
    // Decimal dollars, read and written as a string so no amount passes through a float.
    estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6 }),
    priceVersion: text('price_version'),
    ownerId: uuid('owner_id').references(() => members.id),
    resourceType: text('resource_type'),
    resourceId: uuid('resource_id'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    errorCode: text('error_code'),
  },
  (t) => [
    check('usage_records_kind_check', isOneOf(t.kind, USAGE_KINDS)),
    check('usage_records_status_check', isOneOf(t.status, USAGE_STATUSES)),
  ],
);
