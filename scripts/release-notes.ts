// Prints the release notes of a version: its section in CHANGELOG.md (see scripts/lib/changelog.ts).
// The release workflow uses the output as the body of the GitHub release, so a version without a
// section, or with an empty one, fails instead of producing a release without notes.
// Usage: node scripts/release-notes.ts <version>
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { versionSection } from './lib/changelog.ts';
import { repoRoot } from './lib/node-tools.ts';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/release-notes.ts <version>');
  process.exit(2);
}

const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
if (!existsSync(changelogPath)) {
  console.error('CHANGELOG.md does not exist.');
  process.exit(1);
}

const notes = versionSection(readFileSync(changelogPath, 'utf8'), version);
if (notes === null) {
  console.error(`CHANGELOG.md has no section for ${version}; add "## [${version}] - <date>".`);
  process.exit(1);
}
if (notes === '') {
  console.error(`The section for ${version} in CHANGELOG.md is empty.`);
  process.exit(1);
}

console.log(notes);
