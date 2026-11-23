// The audio bucket as tests see it: putting objects there, reading them back and checking they
// are gone. The integration and security tests use the S3Mock bucket; the speech service's smoke
// test reads the deployed target's bucket. Either way the bucket is the one the S3_* values name.
// Only test files import this module.
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { s3ClientFor, storageSettingsFromEnv, type ObjectStorage } from './object-storage.ts';

export function testBucket() {
  const settings = storageSettingsFromEnv();
  const client = s3ClientFor(settings);
  const head = (key: string): Promise<HeadObjectCommandOutput> =>
    client.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
  return {
    async put(key: string, body: string | Uint8Array = 'test audio') {
      await client.send(new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: body }));
    },
    async has(key: string) {
      try {
        await head(key);
        return true;
      } catch {
        return false;
      }
    },
    /** The object's bytes and content type. */
    async read(key: string) {
      const object = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }));
      const bytes = await object.Body!.transformToByteArray();
      return { bytes, contentType: object.ContentType };
    },
  };
}

/** Storage that fails every write and deletion, as an unreachable bucket does. */
export const failingStorage: ObjectStorage = {
  async putObject() {
    throw new Error('The bucket is unreachable.');
  },
  async deleteObject() {
    throw new Error('The bucket is unreachable.');
  },
};
