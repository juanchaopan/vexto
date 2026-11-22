// Column and constraint builders the table definitions share, so every table follows the
// conventions of .docs/design/data.md the same way: UUID primary keys, times as timestamptz, and
// CHECK constraints written from the same value lists the code validates with.
import { sql, type SQL } from 'drizzle-orm';
import { customType, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** A UUID primary key the database fills in when a row is inserted without one. */
export function uuidPrimaryKey(name = 'id') {
  return uuid(name).primaryKey().defaultRandom();
}

/** A point in time, stored as timestamptz in UTC and read as a Date. */
export function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true, mode: 'date' });
}

/** PostgreSQL's full-text search document; the database computes it, the code never writes it. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

/** An English full-text document generated from a text column of the same table. */
export function englishDocument(source: () => AnyPgColumn): () => SQL {
  return () => sql`to_tsvector('english', ${source()})`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * `column IN ('a', 'b', …)` for a CHECK constraint. The values are the code's own constant lists,
 * written into the DDL as literals because a constraint cannot take bound parameters.
 */
export function isOneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map(quoteLiteral).join(', '))})`;
}

/** `column BETWEEN low AND high` for a CHECK constraint on an integer column. */
export function isBetween(column: AnyPgColumn, low: number, high: number): SQL {
  return sql`${column} between ${sql.raw(String(low))} and ${sql.raw(String(high))}`;
}
