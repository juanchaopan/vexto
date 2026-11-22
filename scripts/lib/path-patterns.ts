// Path patterns shared by the step check and the risk classifier. A pattern is written relative
// to the repository root with forward slashes:
//   **   any number of directories, including none (`**/*.md` matches `README.md` and `a/b.md`)
//   *    any characters within one path segment
// Every other character matches itself, and a pattern always matches the whole path.

const cache = new Map<string, RegExp>();

function escapeLiteral(text: string) {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function segmentSource(segment: string) {
  return segment.split('*').map(escapeLiteral).join('[^/]*');
}

/** Converts a path pattern into a regular expression that matches whole paths. */
function patternToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) {
    return cached;
  }
  const segments = pattern.split('/');
  let source = '';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') {
      // A trailing `**` matches everything below the directory; elsewhere it matches zero or
      // more whole directories, so `a/**/b` matches `a/b` and `a/x/y/b`.
      source += last ? '.*' : '(?:[^/]+/)*';
      return;
    }
    source += segmentSource(segment) + (last ? '' : '/');
  });
  const expression = new RegExp(`^${source}$`);
  cache.set(pattern, expression);
  return expression;
}

/** Normalizes a path as git or a shell may print it: forward slashes, no leading `./`. */
export function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

export function matchesPattern(filePath: string, pattern: string) {
  return patternToRegExp(pattern).test(normalizePath(filePath));
}

export function matchesAny(filePath: string, patterns: readonly string[]) {
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}
