import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

// The global setup has started the services and put their values into process.env, where the
// code under test reads them.
const env = process.env;

describe('the throwaway test services', () => {
  const sql = postgres(env.DATABASE_URL ?? '', { max: 1 });
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });

  afterAll(async () => {
    await sql.end();
    s3.destroy();
  });

  it('serve a PostgreSQL 18 database at DATABASE_URL', async () => {
    const [{ version }] = await sql<{ version: string }[]>`select version()`;

    expect(version).toMatch(/^PostgreSQL 18\./);
  });

  it('serve the bucket S3_BUCKET at S3_ENDPOINT with path-style addresses', async () => {
    const object = { Bucket: env.S3_BUCKET, Key: 'speech/check.mp3' };
    await s3.send(new PutObjectCommand({ ...object, Body: 'ID3', ContentType: 'audio/mpeg' }));
    const stored = await s3.send(new GetObjectCommand(object));

    expect(await stored.Body?.transformToString()).toBe('ID3');
    expect(stored.ContentType).toBe('audio/mpeg');
  });
});
