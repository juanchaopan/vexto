import { PgDialect, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { englishDocument, isBetween, isOneOf } from './columns.ts';

const table = pgTable('things', { state: text('state'), count: integer('count') });
const dialect = new PgDialect();

describe('isOneOf', () => {
  it('writes the values as quoted literals, without parameters', () => {
    const query = dialect.sqlToQuery(isOneOf(table.state, ['ready', "it's"]));

    expect(query.sql).toBe(`"things"."state" in ('ready', 'it''s')`);
    expect(query.params).toEqual([]);
  });
});

describe('isBetween', () => {
  it('writes an inclusive range with literal bounds', () => {
    const query = dialect.sqlToQuery(isBetween(table.count, 0, 5));

    expect(query.sql).toBe(`"things"."count" between 0 and 5`);
    expect(query.params).toEqual([]);
  });
});

describe('englishDocument', () => {
  it('generates the English full-text document of the column', () => {
    const query = dialect.sqlToQuery(englishDocument(() => table.state)());

    expect(query.sql).toBe(`to_tsvector('english', "things"."state")`);
  });
});
