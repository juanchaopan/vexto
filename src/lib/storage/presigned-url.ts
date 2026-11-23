// Playback addresses of objects in the private audio bucket (.docs/design/rules.md, 朗读和存储上限):
// presigned GET addresses, so the browser fetches the audio from the bucket itself, with Range
// requests, and the web application never relays it. Signing happens locally with the bucket's
// credentials; nothing is sent to the bucket. Only the web application signs addresses, so this
// module is apart from object-storage.ts, which the Cloud Run image also loads.
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3ClientFor, storageSettingsFromEnv, type StorageSettings } from './object-storage.ts';

export type ObjectUrls = {
  /** A GET address of the object that works for `expiresInSeconds` from now. */
  getUrl(key: string, expiresInSeconds: number): Promise<string>;
};

export function createObjectUrls(settings: StorageSettings): ObjectUrls {
  const client = s3ClientFor(settings);
  return {
    getUrl: (key, expiresInSeconds) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: settings.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      }),
  };
}

type Env = Readonly<Record<string, string | undefined>>;

/** Addresses in the bucket of the runtime values; the client is made on the first call. */
export function objectUrlsFromEnv(env: Env = process.env): ObjectUrls {
  let urls: ObjectUrls | undefined;
  return {
    async getUrl(key, expiresInSeconds) {
      urls ??= createObjectUrls(storageSettingsFromEnv(env));
      return urls.getUrl(key, expiresInSeconds);
    },
  };
}
