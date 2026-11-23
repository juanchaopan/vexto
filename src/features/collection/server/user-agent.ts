// The User-Agent of every fetch of the collection job (.docs/design/rules.md, 抓取的限制):
// `vexto/<version> (+<repository>)`, so a site owner can see who fetches and where to look. The
// version is the release version in VERSION at the repository root, which the image carries too.
import { readFileSync } from 'node:fs';

const versionFile = new URL('../../../../VERSION', import.meta.url);

export function collectionUserAgent(repositoryUrl: string, version: string = readVersion()) {
  return `vexto/${version} (+${repositoryUrl})`;
}

function readVersion() {
  return readFileSync(versionFile, 'utf8').trim();
}
