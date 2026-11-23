import { afterAll, describe, expect, it, vi } from 'vitest';
import { memberRow, signInAsMember } from '../../../../features/account/testing.ts';
import { expectApiError, jsonRequest } from '../../../../lib/api/testing.ts';
import { closeDatabase } from '../../../../lib/db/client.ts';
import { POST } from './route.ts';

// Hostile bodies sent to the terms acceptance: each is refused as invalid input, the answer does
// not repeat the input, and nothing is recorded.

vi.mock(
  '@clerk/nextjs/server',
  async () => (await import('../../../../features/account/testing.ts')).clerkServerStandIn,
);
vi.mock('next/server', async () =>
  (await import('../../../../features/account/testing.ts')).nextServerStandIn(),
);

afterAll(async () => {
  await closeDatabase();
});

const hostileBodies: [string, string][] = [
  ['an empty body', ''],
  ['text that is not JSON', 'version=1'],
  ['broken JSON', '{"version":1'],
  ['null', 'null'],
  ['an array', '[1]'],
  ['a number', '1'],
  ['no version', '{}'],
  ['the version as a string', '{"version":"1"}'],
  ['SQL in the version', `{"version":"1; UPDATE members SET status = 'active'"}`],
  ['a fraction', '{"version":1.5}'],
  ['zero', '{"version":0}'],
  ['a negative version', '{"version":-1}'],
  ['a version past the integer column', '{"version":2147483648}'],
  ['a huge number', '{"version":1e309}'],
  ['the version as an object', '{"version":{"$gt":0}}'],
  ['an extra field', '{"version":1,"termsAcceptedAt":"2020-01-01T00:00:00Z"}'],
  ['a prototype key', '{"version":1,"__proto__":{"admin":true}}'],
  ['a very long body', JSON.stringify({ version: 1, padding: 'x'.repeat(1_000_000) })],
];

describe('POST /api/terms/acceptance with hostile input', () => {
  it.each(hostileBodies)('refuses %s and records nothing', async (_, body) => {
    const member = await signInAsMember({ termsVersion: null });

    const response = await POST(jsonRequest('/api/terms/acceptance', body));

    const text = await response.clone().text();
    await expectApiError(response, 'INVALID_INPUT');
    expect(text).not.toContain('UPDATE members');
    expect(text.length).toBeLessThan(2000);
    expect(await memberRow(member.id)).toMatchObject({ termsVersion: null, termsAcceptedAt: null });
  });
});
