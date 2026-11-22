import { describe, expect, it } from 'vitest';
import { versionSection } from './changelog.ts';

const changelog = [
  '# 更新日志',
  '',
  '## [未发布]',
  '',
  '## [1.2.0] - 2026-12-01',
  '',
  '### 新增',
  '',
  '- 生词本可以批量删除。',
  '',
  '## [1.1.10] - 2026-11-30',
  '',
  '### 修复',
  '',
  '- 查词结果不再重复。',
  '',
  '[1.2.0]: https://example.com/compare/v1.1.10...v1.2.0',
  '[1.1.10]: https://example.com/releases/tag/v1.1.10',
  '',
].join('\n');

describe('versionSection', () => {
  it('returns the text between the version heading and the next heading', () => {
    expect(versionSection(changelog, '1.2.0')).toBe('### 新增\n\n- 生词本可以批量删除。');
  });

  it('accepts the version with a leading v', () => {
    expect(versionSection(changelog, 'v1.2.0')).toBe('### 新增\n\n- 生词本可以批量删除。');
  });

  it('leaves out the link definitions after the last section', () => {
    expect(versionSection(changelog, '1.1.10')).toBe('### 修复\n\n- 查词结果不再重复。');
  });

  it('does not match a version that only starts the same way', () => {
    expect(versionSection(changelog, '1.1.1')).toBeNull();
  });

  it('returns an empty text for a heading without entries', () => {
    expect(versionSection('## [1.0.0] - 2026-10-01\n\n## [0.9.0]\n- a', '1.0.0')).toBe('');
  });

  it('reads headings written without brackets and with Windows line endings', () => {
    expect(versionSection('## 2.0.0 - 2027-01-01\r\n\r\n- 改了很多。\r\n', '2.0.0')).toBe(
      '- 改了很多。',
    );
  });
});
