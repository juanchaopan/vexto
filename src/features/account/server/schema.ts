// The member list and the terms acceptances (.docs/design/data.md, 成员). `task member` adds and
// revokes rows; the web application binds the Clerk user and records the accepted terms version.
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { isOneOf, timestamptz, uuidPrimaryKey } from '../../../lib/db/columns.ts';
import { MEMBER_STATUSES, type MemberStatus } from '../domain/member.ts';

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
