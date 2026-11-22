import { expect, test } from '@playwright/test';

// The deployment job runs this against the deployed vexto-tts service, which accepts only
// callers with Run Invoker: it sets TTS_SERVICE_URL and TTS_ID_TOKEN, a Google identity token of
// its service account for that address. Elsewhere, such as the end-to-end run against a local
// build, there is no service to call and the test is skipped. The request goes through fetch
// rather than Playwright's request context, so the token never lands in a trace.
const serviceUrl = process.env.TTS_SERVICE_URL;
const idToken = process.env.TTS_ID_TOKEN;

test(
  'speech service answers its health check for the deployment identity',
  { tag: ['@smoke', '@production-safe'] },
  async () => {
    test.skip(!serviceUrl || !idToken, 'TTS_SERVICE_URL and TTS_ID_TOKEN are not set.');

    const response = await fetch(new URL('/health', serviceUrl), {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  },
);
