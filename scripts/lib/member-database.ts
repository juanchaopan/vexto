// The database interface of the member statements (members.ts) on a postgres.js connection.
import type postgres from 'postgres';
import type { MemberDatabase, MemberSession } from './members.ts';

function sessionOf(connection: postgres.ISql): MemberSession {
  return {
    query: async ({ text, params }) => [...(await connection.unsafe(text, [...params]))],
  };
}

/** Runs the member statements on this connection pool, each transaction on one connection. */
export function memberDatabase(sql: postgres.Sql): MemberDatabase {
  return {
    ...sessionOf(sql),
    transaction: <T>(work: (session: MemberSession) => Promise<T>) =>
      sql.begin((transaction) => work(sessionOf(transaction))) as Promise<T>,
  };
}
