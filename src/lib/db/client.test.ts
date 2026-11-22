import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, createDatabase, getDatabase } from './client.ts';

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeDatabase();
});

describe('createDatabase', () => {
  it('opens no connection until a query runs', async () => {
    const { client } = createDatabase('postgres://user:secret@127.0.0.1:1/none', { max: 1 });

    expect(client.options.max).toBe(1);
    expect(client.options.prepare).toBe(false);
    await client.end();
  });
});

describe('getDatabase', () => {
  it('needs DATABASE_URL', () => {
    vi.stubEnv('DATABASE_URL', '');

    expect(() => getDatabase()).toThrow('DATABASE_URL is not set');
  });

  it('gives the same database on every call until it is closed', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://user:secret@127.0.0.1:1/none');
    const database = getDatabase();

    expect(getDatabase()).toBe(database);
    await closeDatabase();
    expect(getDatabase()).not.toBe(database);
  });
});
