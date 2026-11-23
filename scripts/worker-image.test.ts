import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './lib/node-tools.ts';

const dockerfile = readFileSync(path.join(repoRoot, 'worker.Dockerfile'), 'utf8');
const baseImages = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((match) => match[1]);

describe('worker.Dockerfile', () => {
  it('builds on the Node.js version of .nvmrc, pinned by digest', () => {
    const nodeVersion = readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim();
    const external = baseImages.filter((image) => image.includes(':'));

    expect(external).toHaveLength(1);
    expect(external[0]).toMatch(
      new RegExp(`^node:${nodeVersion.replaceAll('.', '\\.')}-[a-z]+-slim@sha256:[0-9a-f]{64}$`),
    );
  });

  it('runs as the unprivileged node user and leaves the entry to Cloud Run', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^ENTRYPOINT \["node"\]$/m);
    expect(dockerfile).not.toMatch(/^CMD /m);
  });
});
