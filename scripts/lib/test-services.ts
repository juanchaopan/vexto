// Throwaway PostgreSQL and object storage for the integration, security and end-to-end tests.
// Testcontainers starts a PostgreSQL container and an Adobe S3Mock container on random host
// ports, creates the test bucket, and removes both when the run ends, also when it is
// interrupted (its reaper container cleans up after a process that died). The database is built
// from empty with the migration scripts, as a deployment builds it.
//
// The services are handed to the code under test through the runtime values it reads in
// production: DATABASE_URL and the S3_* names of scripts/lib/runtime-env.ts. The storage
// credentials are fixed test values, since S3Mock does not check them.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';
import { run } from './node-tools.ts';

// Images are pinned by tag and digest; Renovate updates both.
export const POSTGRES_IMAGE =
  'postgres:18@sha256:eb63372c1e05c755f55fa30cbd07aecc443676fc6c0fa90b9002d01537841e1a';
export const S3MOCK_IMAGE =
  'adobe/s3mock:5.2.3@sha256:ab01a6946750f451ca215a47e91030695b260e4003b8a5a6201d25029b8fca92';

const S3MOCK_PORT = 9090;
const POSTGRES_PORT = 5432;
const DATABASE = 'vexto';
const BUCKET = 'vexto-test-audio';
const REGION = 'us-east-1';

/** The runtime values that point the code under test at the test services. */
export type TestServiceEnv = {
  DATABASE_URL: string;
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
};

export type TestServices = {
  /** Values for code on this machine, through the containers' published ports. */
  env: TestServiceEnv;
  /** Values for a container on `network`, through the services' network aliases. */
  networkEnv: TestServiceEnv;
  /** Docker network the services are on, when they were started on one. */
  network?: string;
  stop(): Promise<void>;
};

declare module 'vitest' {
  export interface ProvidedContext {
    testServices: TestServiceEnv;
  }
}

function serviceEnv(databaseUrl: string, s3Endpoint: string): TestServiceEnv {
  return {
    DATABASE_URL: databaseUrl,
    S3_ENDPOINT: s3Endpoint,
    S3_REGION: REGION,
    S3_BUCKET: BUCKET,
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test',
  };
}

function startPostgres(network: StartedNetwork | undefined) {
  const container = new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase(DATABASE);
  return (
    network ? container.withNetwork(network).withNetworkAliases('postgres') : container
  ).start();
}

/**
 * S3Mock counts as started once it lists the test bucket: the first request of the S3 interface
 * makes it set up its request handling, which takes seconds on a busy machine, so it is made
 * here rather than by the first test that stores an object.
 */
function startS3Mock(network: StartedNetwork | undefined) {
  const container = new GenericContainer(S3MOCK_IMAGE)
    .withExposedPorts(S3MOCK_PORT)
    .withEnvironment({
      COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS: BUCKET,
      COM_ADOBE_TESTING_S3MOCK_STORE_REGION: REGION,
    })
    .withWaitStrategy(Wait.forHttp(`/${BUCKET}?list-type=2`, S3MOCK_PORT).forStatusCode(200));
  return (network ? container.withNetwork(network).withNetworkAliases('s3') : container).start();
}

/** Applies the migration scripts in drizzle/ to the database, as `task migrate` does. */
export async function migrateTestDatabase(databaseUrl: string) {
  const code = await run(process.execPath, ['scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: '' },
  });
  if (code !== 0) {
    throw new Error(`Migrating the test database failed (exit code ${code}).`);
  }
}

function networkEnvOf(postgres: StartedPostgreSqlContainer) {
  const user = encodeURIComponent(postgres.getUsername());
  const password = encodeURIComponent(postgres.getPassword());
  return serviceEnv(
    `postgres://${user}:${password}@postgres:${POSTGRES_PORT}/${DATABASE}`,
    `http://s3:${S3MOCK_PORT}`,
  );
}

/**
 * Starts the services, migrates the database and resolves once both answer. With `onNetwork`
 * they also join a new Docker network, for a test container that reaches them by name.
 */
export async function startTestServices(options: { onNetwork?: boolean } = {}) {
  const network = options.onNetwork ? await new Network().start() : undefined;
  let postgres: StartedPostgreSqlContainer | undefined;
  let s3: StartedTestContainer | undefined;
  const stop = async () => {
    await Promise.all([postgres?.stop(), s3?.stop()]);
    await network?.stop();
  };
  try {
    [postgres, s3] = await Promise.all([startPostgres(network), startS3Mock(network)]);
    const env = serviceEnv(
      postgres.getConnectionUri(),
      `http://${s3.getHost()}:${s3.getMappedPort(S3MOCK_PORT)}`,
    );
    await migrateTestDatabase(env.DATABASE_URL);
    const services: TestServices = {
      env,
      networkEnv: networkEnvOf(postgres),
      network: network?.getName(),
      stop,
    };
    return services;
  } catch (error) {
    await stop();
    throw error;
  }
}
