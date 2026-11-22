import { describe, expect, it } from 'vitest';
import {
  judgeLicense,
  listingProblems,
  parseLicenseExpression,
  type InstalledPackage,
} from './license-policy.ts';

const pkg = (name: string, license: InstalledPackage['license']): InstalledPackage => ({
  name,
  version: '1.0.0',
  license,
});

describe('parseLicenseExpression', () => {
  it('binds AND tighter than OR and honours parentheses', () => {
    expect(parseLicenseExpression('MIT OR Apache-2.0 AND ISC')).toEqual({
      kind: 'or',
      parts: [
        { kind: 'license', id: 'MIT' },
        {
          kind: 'and',
          parts: [
            { kind: 'license', id: 'Apache-2.0' },
            { kind: 'license', id: 'ISC' },
          ],
        },
      ],
    });
    expect(parseLicenseExpression('(MIT)')).toEqual({ kind: 'license', id: 'MIT' });
  });

  it('keeps WITH exceptions with their license', () => {
    expect(parseLicenseExpression('GPL-2.0-only WITH Classpath-exception-2.0')).toEqual({
      kind: 'license',
      id: 'GPL-2.0-only WITH Classpath-exception-2.0',
    });
  });

  it.each(['', 'MIT AND', '(MIT', 'MIT)', 'OR MIT'])('rejects "%s"', (expression) => {
    expect(() => parseLicenseExpression(expression)).toThrow();
  });
});

describe('judgeLicense', () => {
  it.each(['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', '0BSD', '(MIT OR GPL-3.0-only)'])(
    'allows %s for any package',
    (license) => {
      expect(judgeLicense(pkg('some-package', license))).toBe('allowed');
    },
  );

  it.each([
    'GPL-3.0-only',
    'AGPL-3.0-or-later',
    'LGPL-3.0-or-later',
    'MIT AND GPL-2.0-only',
    'UNKNOWN',
    'Custom: LICENSE.txt',
    'MIT*',
    'CC-BY-4.0',
    'GPL-2.0-only WITH Classpath-exception-2.0',
  ])('rejects %s for an ordinary package', (license) => {
    expect(judgeLicense(pkg('some-package', license))).toBe('rejected');
  });

  it('rejects a package without a license and checks every entry of a license list', () => {
    expect(judgeLicense(pkg('some-package', []))).toBe('rejected');
    expect(judgeLicense(pkg('some-package', ['MIT', 'Apache-2.0']))).toBe('allowed');
    expect(judgeLicense(pkg('some-package', ['MIT', 'GPL-3.0-only']))).toBe('rejected');
  });

  it('allows LGPL-3.0-or-later for the sharp libvips and platform packages', () => {
    const libvips = pkg('@img/sharp-libvips-linux-x64', 'LGPL-3.0-or-later');
    const platform = pkg('@img/sharp-win32-x64', 'Apache-2.0 AND LGPL-3.0-or-later');
    expect(judgeLicense(libvips)).toBe('exception');
    expect(judgeLicense(platform)).toBe('exception');
    expect(judgeLicense(pkg('@img/sharp-linux-x64', 'Apache-2.0'))).toBe('allowed');
  });

  it('gives the sharp packages no other GPL-class license', () => {
    const withGpl = 'Apache-2.0 AND LGPL-3.0-or-later AND GPL-3.0-only';
    expect(judgeLicense(pkg('@img/sharp-linux-x64', 'GPL-3.0-or-later'))).toBe('rejected');
    expect(judgeLicense(pkg('@img/sharp-libvips-linux-x64', 'LGPL-2.1-only'))).toBe('rejected');
    expect(judgeLicense(pkg('@img/sharp-win32-x64', withGpl))).toBe('rejected');
  });

  it('limits the sharp exception to the @img/sharp-* packages', () => {
    expect(judgeLicense(pkg('@img/colour', 'LGPL-3.0-or-later'))).toBe('rejected');
    expect(judgeLicense(pkg('sharp', 'LGPL-3.0-or-later'))).toBe('rejected');
    expect(judgeLicense(pkg('@other/sharp-linux-x64', 'LGPL-3.0-or-later'))).toBe('rejected');
  });

  it('allows CC-BY-4.0 for caniuse-lite only', () => {
    expect(judgeLicense(pkg('caniuse-lite', 'CC-BY-4.0'))).toBe('exception');
    expect(judgeLicense(pkg('caniuse-lite', 'GPL-3.0-only'))).toBe('rejected');
    expect(judgeLicense(pkg('caniuse-db', 'CC-BY-4.0'))).toBe('rejected');
  });
});

describe('listingProblems', () => {
  it('reports a listing that has sharp but no platform package', () => {
    expect(listingProblems([pkg('sharp', 'Apache-2.0')])).toHaveLength(1);
    expect(
      listingProblems([
        pkg('sharp', 'Apache-2.0'),
        pkg('@img/sharp-linux-x64', 'Apache-2.0 AND LGPL-3.0-or-later'),
      ]),
    ).toEqual([]);
    expect(listingProblems([pkg('next', 'MIT')])).toEqual([]);
  });
});
