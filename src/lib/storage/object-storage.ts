// The private audio bucket (.docs/architecture.md, 对象存储): Neon Object Storage over the S3
// protocol with path-style addresses, or S3Mock on a development machine and in tests. The
// bucket's location and credentials are the runtime values S3_ENDPOINT, S3_REGION, S3_BUCKET,
// S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. Nothing connects when this module is imported, and
// the values are read on first use, so a process that never touches the bucket does not need
// them.
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type StorageSettings = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type ObjectStorage = {
  /** Writes the object, replacing one already at that key. */
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Deletes the object; deleting one that does not exist succeeds as well. */
  deleteObject(key: string): Promise<void>;
};

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string) {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set; it must name the audio bucket.`);
  }
  return value;
}

export function storageSettingsFromEnv(env: Env = process.env): StorageSettings {
  return {
    endpoint: required(env, 'S3_ENDPOINT'),
    region: required(env, 'S3_REGION'),
    bucket: required(env, 'S3_BUCKET'),
    accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
  };
}

/** An S3 client for the bucket's endpoint, with path-style addresses. */
export function s3ClientFor(settings: StorageSettings): S3Client {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
}

export function createObjectStorage(settings: StorageSettings): ObjectStorage {
  const client = s3ClientFor(settings);
  return {
    async putObject(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: settings.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.byteLength,
        }),
      );
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
    },
  };
}

/** The bucket of the runtime values; its client is made on the first call. */
export function objectStorageFromEnv(env: Env = process.env): ObjectStorage {
  let storage: ObjectStorage | undefined;
  const current = () => (storage ??= createObjectStorage(storageSettingsFromEnv(env)));
  return {
    putObject: (key, body, contentType) => current().putObject(key, body, contentType),
    deleteObject: (key) => current().deleteObject(key),
  };
}
