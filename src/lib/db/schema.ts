// Tables several features share (.docs/design/data.md). The features' own tables are in their
// server/schema.ts files; drizzle-kit reads all of them (drizzle.config.ts).
import { check, index, integer, jsonb, primaryKey, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { isOneOf, timestamptz } from './columns.ts';

/** The write operations that carry an operationId, as recorded in `operation_receipts.kind`. */
export const OPERATION_KINDS = [
  'lookup.create',
  'lookup.refresh-example',
  'vocabulary.save',
  'vocabulary.replace',
  'vocabulary.refresh-example',
  'vocabulary.delete',
  'vocabulary.bulk-delete',
  'review.submit',
] as const;

export type OperationKind = (typeof OPERATION_KINDS)[number];

/**
 * Receipts of write operations, kept 24 hours, so a repeated request gets the first answer.
 * `owner_id` references `members.id`. The members table belongs to the account feature, which
 * this shared module may not import, so that foreign key is added by the migration script
 * drizzle/0001_seed_and_shared_keys.sql rather than declared here.
 */
export const operationReceipts = pgTable(
  'operation_receipts',
  {
    ownerId: uuid('owner_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    kind: text('kind').$type<OperationKind>().notNull(),
    requestDigest: text('request_digest').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: jsonb('response_body'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'operation_receipts_pkey', columns: [t.ownerId, t.operationId] }),
    index('operation_receipts_created_at_idx').on(t.createdAt),
    check('operation_receipts_kind_check', isOneOf(t.kind, OPERATION_KINDS)),
  ],
);
