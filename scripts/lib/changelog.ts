// Reads one version's section from a changelog in the Keep a Changelog layout: every version
// starts with a level-two heading such as `## [1.2.0] - 2026-12-01`, and link definitions such as
// `[1.2.0]: https://...` may follow the last section.

const sectionHeading = /^## /;
const linkDefinition = /^\[[^\]]+\]:\s/;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function headingOf(version: string) {
  const bare = escapeRegExp(version.replace(/^v/, ''));
  return new RegExp(`^## \\[?v?${bare}\\]?(?:\\s|$)`);
}

function isTrailingFiller(line: string) {
  return line.trim() === '' || linkDefinition.test(line);
}

/**
 * The text under the heading of a version, without the heading, surrounding blank lines and
 * trailing link definitions; null when the changelog has no heading for the version.
 */
export function versionSection(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const heading = headingOf(version);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    return null;
  }
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => sectionHeading.test(line));
  const body = next === -1 ? rest : rest.slice(0, next);
  let end = body.length;
  while (end > 0 && isTrailingFiller(body[end - 1])) {
    end -= 1;
  }
  return body.slice(0, end).join('\n').trim();
}
