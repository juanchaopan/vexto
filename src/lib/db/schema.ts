// Tables several features share (.docs/design/data.md). The features' own tables are in their
// server/schema.ts files; drizzle-kit reads all of them (drizzle.config.ts).
//
// The member list is here because nearly every feature's tables point at it: a feature reaches
// another only through its index.ts, and the account feature's index also carries the web
// application's sign-in code and components, which the Cloud Run image does not have. With the
// table here, the collection job reads articles and usage records without loading any of that.
// The account feature owns the rows: it is the one that queries and changes them.
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, primaryKey, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { isOneOf, timestamptz, uuidPrimaryKey } from './columns.ts';

/** A member is `active` while invited and `revoked` once removed from the list. */
export const MEMBER_STATUSES = ['active', 'revoked'] as const;

export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/**
 * The member list and the terms acceptances (.docs/design/data.md, 成员). `task member` adds and
 * revokes rows; the web application binds the Clerk user and records the accepted terms version.
 */
export const members = pgTable(
  'members',
  {
    id: uuidPrimaryKey(),
    email: text('email').notNull().unique('members_email_key'),
    clerkUserId: text('clerk_user_id').unique('members_clerk_user_id_key'),
    status: text('status').$type<MemberStatus>().notNull(),
    termsVersion: integer('terms_version'),
    termsAcceptedAt: timestamptz('terms_accepted_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('members_email_lower_check', sql`${t.email} = lower(${t.email})`),
    check('members_status_check', isOneOf(t.status, MEMBER_STATUSES)),
  ],
);

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
 * `owner_id` references `members.id` through a foreign key the migration script
 * drizzle/0001_seed_and_shared_keys.sql creates, so the key is not declared here a second time.
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
