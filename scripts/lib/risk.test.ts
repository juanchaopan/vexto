import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './node-tools.ts';
import { classifyRisk, parseRiskRules } from './risk.ts';

const sampleRules = parseRiskRules(`
# comment
[high]
.github/**
**/auth/**
lefthook.yml

[low]
.docs/**
**/*.md
**/*.txt
`);

describe('parseRiskRules', () => {
  it('reads patterns by section and skips comments and blank lines', () => {
    expect(sampleRules).toEqual({
      high: ['.github/**', '**/auth/**', 'lefthook.yml'],
      low: ['.docs/**', '**/*.md', '**/*.txt'],
    });
  });

  it('accepts Windows line endings', () => {
    expect(parseRiskRules('[high]\r\na\r\n[low]\r\nb\r\n')).toEqual({ high: ['a'], low: ['b'] });
  });

  it('rejects patterns before a section, unknown sections and empty sections', () => {
    expect(() => parseRiskRules('a\n[high]\nb\n[low]\nc')).toThrow(/comes before/);
    expect(() => parseRiskRules('[medium]\na')).toThrow(/unknown section/);
    expect(() => parseRiskRules('[high]\na')).toThrow(/at least one/);
  });
});

describe('classifyRisk', () => {
  it('is high when any file matches a high pattern', () => {
    expect(classifyRisk(sampleRules, ['src/a.ts', '.github/workflows/ci.yml']).tier).toBe('high');
    expect(classifyRisk(sampleRules, ['src/features/auth/server/x.ts']).tier).toBe('high');
  });

  it('lets high win over low for a file matching both', () => {
    expect(classifyRisk(sampleRules, ['.github/risk-rules.txt']).tier).toBe('high');
    expect(classifyRisk(sampleRules, ['README.md', 'src/auth/notes.md']).tier).toBe('high');
  });

  it('is low only when every file matches a low pattern', () => {
    expect(classifyRisk(sampleRules, ['.docs/brief.md', 'README.md', 'a/b/c.txt']).tier).toBe(
      'low',
    );
    expect(classifyRisk(sampleRules, ['.docs/brief.md', 'src/a.ts']).tier).toBe('medium');
  });

  it('is medium for files matching neither and for an empty change', () => {
    expect(classifyRisk(sampleRules, ['src/a.ts']).tier).toBe('medium');
    expect(classifyRisk(sampleRules, []).tier).toBe('medium');
  });

  it('is high for any change from a release branch', () => {
    expect(classifyRisk(sampleRules, ['.docs/brief.md'], 'release/1.4.0').tier).toBe('high');
    expect(classifyRisk(sampleRules, [], 'release/1.4.0').tier).toBe('high');
    expect(classifyRisk(sampleRules, ['.docs/brief.md'], 'feature/2-x').tier).toBe('low');
  });

  it('separates ** across directories from * within one level', () => {
    const rules = parseRiskRules('[high]\nsrc/*.ts\n[low]\n**/*.md');
    expect(classifyRisk(rules, ['src/a.ts']).tier).toBe('high');
    expect(classifyRisk(rules, ['src/lib/a.ts']).tier).toBe('medium');
    expect(classifyRisk(rules, ['src/lib/deep/notes.md']).tier).toBe('low');
  });

  it('explains the tier', () => {
    expect(classifyRisk(sampleRules, ['lefthook.yml', 'src/a.ts']).reason).toBe(
      'High-risk files: lefthook.yml.',
    );
  });
});

describe('the repository risk rules', () => {
  const rules = parseRiskRules(
    readFileSync(path.join(repoRoot, '.github', 'risk-rules.txt'), 'utf8'),
  );
  const tierOf = (file: string) => classifyRisk(rules, [file]).tier;

  it.each([
    '.github/workflows/ci.yml',
    '.github/risk-rules.txt',
    'lefthook.yml',
    '.claude/settings.json',
    'AGENTS.md',
    'CLAUDE.md',
    'REVIEW.md',
    'Taskfile.yml',
    'eslint.config.mjs',
    '.prettierrc.json',
    '.prettierignore',
    '.dependency-cruiser.cjs',
    '.jscpd.json',
    'commitlint.config.mjs',
    '.markdownlint-cli2.jsonc',
    '.gitleaks.toml',
    'tsconfig.json',
    'vitest.config.ts',
    'playwright.config.ts',
    'e2e/reader.spec.ts-snapshots/reader-webkit-linux.png',
    'src/features/auth/server/session.ts',
    'drizzle/0001_init.sql',
    'drizzle/meta/_journal.json',
    'scripts/seed.sql',
    '.env.example',
    'vercel.json',
  ])('treats %s as high risk', (file) => {
    expect(tierOf(file)).toBe('high');
  });

  it.each(['.docs/architecture.md', 'README.md', 'src/features/reader/notes.md', 'LICENSE'])(
    'treats %s as low risk',
    (file) => {
      expect(tierOf(file)).toBe('low');
    },
  );

  it.each(['src/app/page.tsx', 'scripts/check-commits.ts', 'package.json', 'pnpm-lock.yaml'])(
    'treats %s as medium risk',
    (file) => {
      expect(tierOf(file)).toBe('medium');
    },
  );
});
