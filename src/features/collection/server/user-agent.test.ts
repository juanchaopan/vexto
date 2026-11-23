import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectionUserAgent } from './user-agent.ts';

describe('collectionUserAgent', () => {
  it('names vexto, its version and the repository', () => {
    expect(collectionUserAgent('https://github.com/example/vexto', '1.2.3')).toBe(
      'vexto/1.2.3 (+https://github.com/example/vexto)',
    );
  });

  it('takes the version from VERSION', () => {
    const version = readFileSync(new URL('../../../../VERSION', import.meta.url), 'utf8').trim();

    expect(collectionUserAgent('https://example.org/repo')).toBe(
      `vexto/${version} (+https://example.org/repo)`,
    );
  });
});
