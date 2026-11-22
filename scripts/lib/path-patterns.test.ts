import { describe, expect, it } from 'vitest';
import { matchesAny, matchesPattern, normalizePath } from './path-patterns.ts';

describe('matchesPattern', () => {
  it('matches a plain path only at the repository root', () => {
    expect(matchesPattern('lefthook.yml', 'lefthook.yml')).toBe(true);
    expect(matchesPattern('sub/lefthook.yml', 'lefthook.yml')).toBe(false);
    expect(matchesPattern('lefthook.yml.bak', 'lefthook.yml')).toBe(false);
  });

  it('lets * match within one directory level only', () => {
    expect(matchesPattern('.docs/brief.md', '.docs/*.md')).toBe(true);
    expect(matchesPattern('.docs/design/screens.md', '.docs/*.md')).toBe(false);
    expect(matchesPattern('README.md', '*.md')).toBe(true);
    expect(matchesPattern('docs/README.md', '*.md')).toBe(false);
  });

  it('lets a trailing ** match everything below a directory', () => {
    expect(matchesPattern('.github/workflows/ci.yml', '.github/**')).toBe(true);
    expect(matchesPattern('.github/risk-rules.txt', '.github/**')).toBe(true);
    expect(matchesPattern('.github', '.github/**')).toBe(false);
    expect(matchesPattern('a.github/x', '.github/**')).toBe(false);
  });

  it('lets a leading **/ match any number of directories, including none', () => {
    expect(matchesPattern('README.md', '**/*.md')).toBe(true);
    expect(matchesPattern('src/features/a/notes.md', '**/*.md')).toBe(true);
    expect(matchesPattern('.env.local', '**/.env*')).toBe(true);
    expect(matchesPattern('apps/web/.env', '**/.env*')).toBe(true);
    expect(matchesPattern('src/env.ts', '**/.env*')).toBe(false);
  });

  it('matches directories named in the middle of a pattern', () => {
    expect(matchesPattern('src/features/auth/server/session.ts', '**/auth/**')).toBe(true);
    expect(matchesPattern('auth/x.ts', '**/auth/**')).toBe(true);
    expect(matchesPattern('src/features/oauth/x.ts', '**/auth/**')).toBe(false);
    expect(matchesPattern('e2e/health.spec.ts-snapshots/a.png', '**/*-snapshots/**')).toBe(true);
    expect(matchesPattern('a/b/c/d', 'a/**/d')).toBe(true);
    expect(matchesPattern('a/d', 'a/**/d')).toBe(true);
  });

  it('treats regular expression characters literally', () => {
    expect(matchesPattern('a+b.txt', 'a+b.txt')).toBe(true);
    expect(matchesPattern('aab.txt', 'a+b.txt')).toBe(false);
    expect(matchesPattern('vercelxjson', 'vercel.json')).toBe(false);
  });

  it('accepts Windows separators and a leading ./', () => {
    expect(normalizePath('.\\src\\app\\page.tsx')).toBe('src/app/page.tsx');
    expect(matchesPattern('.github\\workflows\\ci.yml', '.github/**')).toBe(true);
    expect(matchesPattern('./lefthook.yml', 'lefthook.yml')).toBe(true);
  });
});

describe('matchesAny', () => {
  it('is true when one pattern matches', () => {
    expect(matchesAny('drizzle/0001.sql', ['vercel.json', 'drizzle/**'])).toBe(true);
    expect(matchesAny('src/app/page.tsx', ['vercel.json', 'drizzle/**'])).toBe(false);
    expect(matchesAny('src/app/page.tsx', [])).toBe(false);
  });
});
