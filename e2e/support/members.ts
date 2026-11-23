import postgres from 'postgres';
import { revokedMemberDataStatements } from '../../scripts/lib/members.ts';
import { sharedConfig } from '../../src/lib/config/shared-config.ts';

// The member list of the throwaway database the application under test uses: `task test-e2e`
// hands its address to the test container as DATABASE_URL.

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set; run the end-to-end tests with `task test-e2e`.');
  }
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Runs `work` on a connection of its own to the application's database, then closes it. */
export async function withDatabase<T>(work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = connect();
  try {
    return await work(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Removes the member row of an address with what refers to it, through the same statements that
 * revoking a member runs: every table of the member's personal data is cleared first.
 */
async function removeMember(sql: postgres.Sql, email: string) {
  const [member] = await sql<{ id: string }[]>`SELECT id FROM members WHERE email = ${email}`;
  if (member) {
    for (const { text, params } of revokedMemberDataStatements(member.id)) {
      await sql.unsafe(text, [...params]);
    }
  }
  await sql`DELETE FROM members WHERE email = ${email}`;
}

/**
 * Puts the address on the member list as a new active member who has not signed in yet. A
 * member row of an earlier test with this address goes first, with what refers to it.
 */
export function inviteMember(email: string): Promise<void> {
  return withDatabase(async (sql) => {
    await removeMember(sql, email);
    await sql`INSERT INTO members (email, status) VALUES (${email}, 'active')`;
  });
}

/** Takes the address off the member list, so its account is not a member. */
export function forgetMember(email: string): Promise<void> {
  return withDatabase((sql) => removeMember(sql, email));
}

/** The terms version the member accepted, or null. */
export function acceptedTermsVersion(email: string): Promise<number | null> {
  return withDatabase(async (sql) => {
    const [row] = await sql<{ terms_version: number | null }[]>`
      SELECT terms_version FROM members WHERE email = ${email}`;
    return row?.terms_version ?? null;
  });
}

/**
 * Records that the member accepted the current terms at `acceptedAt`, or, given null, that the
 * member has accepted no terms yet.
 */
export function setTermsAcceptance(email: string, acceptedAt: Date | null): Promise<void> {
  const version = acceptedAt ? sharedConfig.terms.version : null;
  return withDatabase(async (sql) => {
    await sql`
      UPDATE members SET terms_version = ${version}, terms_accepted_at = ${acceptedAt}
      WHERE email = ${email}`;
  });
}
