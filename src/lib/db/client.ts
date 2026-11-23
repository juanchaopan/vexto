// The database connection of the web application and the collection job: postgres.js through
// Drizzle, at the pooled address DATABASE_URL. The pooler is PgBouncer in transaction mode, so
// named prepared statements are turned off, and each process keeps a small pool of its own.
//
// A Vercel function instance serves many invocations, so the pool is made on first use and kept
// on globalThis: later invocations, and module reloads in development, reuse the same
// connections instead of opening new ones. Nothing connects when this module is imported.
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Database = PostgresJsDatabase;

/** A transaction, with the same query builder as the database. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Where a query can run: the database itself or an open transaction. */
export type Executor = Database | Transaction;

export type DatabaseOptions = {
  /** Most connections the pool opens. */
  max?: number;
  /** Name the connections report to the server, to tell the web application and the job apart. */
  applicationName?: string;
};

type Connection = { database: Database; client: postgres.Sql };

const cache = globalThis as typeof globalThis & { vextoDatabase?: Connection };

/** Opens a pool of its own at that address; tests and the job use it, as does getDatabase(). */
export function createDatabase(url: string, options: DatabaseOptions = {}): Connection {
  const client = postgres(url, {
    max: options.max ?? 3,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 30 * 60,
    onnotice: () => {},
    connection: { application_name: options.applicationName ?? 'vexto' },
  });
  return { database: drizzle({ client }), client };
}

/**
 * The shared database of this process, at DATABASE_URL. The first call opens the pool with the
 * given options; later calls return the same pool.
 */
export function getDatabase(options: DatabaseOptions = {}): Database {
  if (!cache.vextoDatabase) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set; it must point at the database.');
    }
    cache.vextoDatabase = createDatabase(url, options);
  }
  return cache.vextoDatabase.database;
}

/** Closes the shared pool, as the collection job does before it exits. */
export async function closeDatabase(): Promise<void> {
  const connection = cache.vextoDatabase;
  cache.vextoDatabase = undefined;
  await connection?.client.end({ timeout: 5 });
}

/**
 * Runs `work` in one transaction on the shared database: committed when it resolves, rolled back
 * when it throws. External calls (AI, speech, storage) never run inside it.
 */
export function inTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return getDatabase().transaction(work);
}
