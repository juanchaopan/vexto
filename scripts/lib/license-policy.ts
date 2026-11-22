// License policy for the runtime dependencies. A package passes when its license expression is
// satisfied by the permissive licenses below, plus the licenses of an exception that names the
// package. GPL-class, unknown and custom licenses fail.
import { matchesPattern } from './path-patterns.ts';

/** Permissive licenses any runtime dependency may use. */
const allowedLicenses: readonly string[] = [
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
];

type LicenseException = {
  /** Package name pattern; `*` matches within the name. */
  packages: string;
  licenses: readonly string[];
};

/**
 * Exceptions the project owner approved, each limited to the packages and licenses it names.
 * - sharp (used by Next.js image optimization) loads libvips from its platform packages: the
 *   @img/sharp-libvips-* packages are LGPL-3.0-or-later, and the @img/sharp-<platform> packages
 *   that bundle libvips are "Apache-2.0 AND LGPL-3.0-or-later"; `@img/sharp-*` names both
 *   families. libvips is a dynamically linked library, used unmodified by a self-hosted web
 *   application that is not distributed, so the LGPL obligations for distributing it do not arise.
 * - caniuse-lite is the browser support data Next.js ships; CC-BY-4.0 only asks for attribution.
 */
const licenseExceptions: readonly LicenseException[] = [
  { packages: '@img/sharp-*', licenses: ['LGPL-3.0-or-later'] },
  { packages: 'caniuse-lite', licenses: ['CC-BY-4.0'] },
];

export type InstalledPackage = {
  name: string;
  version: string;
  /** The license expression; a list from an old `licenses` field must satisfy every entry. */
  license: string | readonly string[];
};

type Expression = { kind: 'license'; id: string } | { kind: 'and' | 'or'; parts: Expression[] };

function tokenize(expression: string) {
  return expression
    .replace(/([()])/g, ' $1 ')
    .split(/\s+/)
    .filter((token) => token !== '');
}

/**
 * Parses an SPDX license expression: identifiers joined by AND and OR, AND binding tighter,
 * with parentheses. `<license> WITH <exception>` stays one identifier.
 */
export function parseLicenseExpression(expression: string): Expression {
  const tokens = tokenize(expression);
  let position = 0;
  const peek = () => tokens[position]?.toUpperCase();
  const unexpected = () =>
    new Error(`Unexpected ${tokens[position] ?? 'end'} in license "${expression}"`);

  function parseOr(): Expression {
    const parts = [parseAnd()];
    while (peek() === 'OR') {
      position += 1;
      parts.push(parseAnd());
    }
    return parts.length === 1 ? parts[0] : { kind: 'or', parts };
  }

  function parseAnd(): Expression {
    const parts = [parseLicense()];
    while (peek() === 'AND') {
      position += 1;
      parts.push(parseLicense());
    }
    return parts.length === 1 ? parts[0] : { kind: 'and', parts };
  }

  function parseLicense(): Expression {
    const token = tokens[position];
    if (token === undefined || token === ')' || ['AND', 'OR', 'WITH'].includes(peek() ?? '')) {
      throw unexpected();
    }
    position += 1;
    if (token === '(') {
      const inner = parseOr();
      if (tokens[position] !== ')') {
        throw unexpected();
      }
      position += 1;
      return inner;
    }
    if (peek() === 'WITH' && tokens[position + 1] !== undefined) {
      const id = `${token} WITH ${tokens[position + 1]}`;
      position += 2;
      return { kind: 'license', id };
    }
    return { kind: 'license', id: token };
  }

  const parsed = parseOr();
  if (position !== tokens.length) {
    throw unexpected();
  }
  return parsed;
}

function satisfied(expression: Expression, accepted: ReadonlySet<string>): boolean {
  switch (expression.kind) {
    case 'license':
      return accepted.has(expression.id);
    case 'and':
      return expression.parts.every((part) => satisfied(part, accepted));
    case 'or':
      return expression.parts.some((part) => satisfied(part, accepted));
  }
}

/** Licenses a package may use: the allowed list plus the exceptions naming the package. */
function acceptedLicensesFor(name: string): Set<string> {
  const accepted = new Set(allowedLicenses);
  licenseExceptions
    .filter((exception) => matchesPattern(name, exception.packages))
    .forEach((exception) => exception.licenses.forEach((license) => accepted.add(license)));
  return accepted;
}

function satisfiedBy(pkg: InstalledPackage, accepted: ReadonlySet<string>) {
  const expressions = typeof pkg.license === 'string' ? [pkg.license] : pkg.license;
  return (
    expressions.length > 0 &&
    expressions.every((expression) => {
      try {
        return satisfied(parseLicenseExpression(expression), accepted);
      } catch {
        return false;
      }
    })
  );
}

export type LicenseVerdict = 'allowed' | 'exception' | 'rejected';

/** Whether a package passes on the allowed list, passes only through an exception, or fails. */
export function judgeLicense(pkg: InstalledPackage): LicenseVerdict {
  if (satisfiedBy(pkg, new Set(allowedLicenses))) {
    return 'allowed';
  }
  return satisfiedBy(pkg, acceptedLicensesFor(pkg.name)) ? 'exception' : 'rejected';
}

/**
 * Problems with the listing itself: sharp loads its native code from an @img/sharp-<platform>
 * package, so a listing that has sharp but none of those packages missed optional dependencies.
 */
export function listingProblems(packages: readonly InstalledPackage[]): string[] {
  const hasSharp = packages.some((pkg) => pkg.name === 'sharp');
  const hasPlatformPackage = packages.some((pkg) => matchesPattern(pkg.name, '@img/sharp-*'));
  return hasSharp && !hasPlatformPackage
    ? ['sharp is installed but no @img/sharp-* platform package was listed.']
    : [];
}
