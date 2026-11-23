import postgres from 'postgres';

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
 * Puts the address on the member list as a new active member who has not signed in yet. A
 * member row of an earlier test with this address goes first, with the visits that refer to it.
 */
export function inviteMember(email: string): Promise<void> {
  return withDatabase(async (sql) => {
    await sql`DELETE FROM visits WHERE owner_id IN (SELECT id FROM members WHERE email = ${email})`;
    await sql`DELETE FROM members WHERE email = ${email}`;
    await sql`INSERT INTO members (email, status) VALUES (${email}, 'active')`;
  });
}

/** Takes the address off the member list, so its account is not a member. */
export function forgetMember(email: string): Promise<void> {
  return withDatabase(async (sql) => {
    await sql`DELETE FROM visits WHERE owner_id IN (SELECT id FROM members WHERE email = ${email})`;
    await sql`DELETE FROM members WHERE email = ${email}`;
  });
}

/** The terms version the member accepted, or null. */
export function acceptedTermsVersion(email: string): Promise<number | null> {
  return withDatabase(async (sql) => {
    const [row] = await sql<{ terms_version: number | null }[]>`
      SELECT terms_version FROM members WHERE email = ${email}`;
    return row?.terms_version ?? null;
  });
}
