// The private audio bucket (.docs/architecture.md, 对象存储): Neon Object Storage over the S3
// protocol with path-style addresses, or S3Mock on a development machine and in tests. The
// bucket's location and credentials are the runtime values S3_ENDPOINT, S3_REGION, S3_BUCKET,
// S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. Nothing connects when this module is imported, and
// the values are read on first use, so a process that never touches the bucket does not need
// them.
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type StorageSettings = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type ObjectStorage = {
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

export function createObjectStorage(settings: StorageSettings): ObjectStorage {
  const client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
  return {
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
    deleteObject: (key) => current().deleteObject(key),
  };
}
