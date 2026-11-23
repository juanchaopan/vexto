import { describe, expect, it } from 'vitest';
import { decodeText } from './text-decoding.ts';

const latin1 = (text: string) => Buffer.from(text, 'latin1');

describe('decodeText', () => {
  it('reads UTF-8 by default', () => {
    expect(decodeText(Buffer.from('café — ok', 'utf8'), null)).toBe('café — ok');
  });

  it('follows the charset of the Content-Type header', () => {
    expect(decodeText(latin1('café'), 'text/html; charset=ISO-8859-1')).toBe('café');
  });

  it('follows the XML declaration or the HTML meta tag when the header names none', () => {
    expect(
      decodeText(latin1('<?xml version="1.0" encoding="iso-8859-1"?><a>é</a>'), 'application/xml'),
    ).toBe('<?xml version="1.0" encoding="iso-8859-1"?><a>é</a>');
    expect(decodeText(latin1('<meta charset="windows-1252"><p>\u0093q\u0094</p>'), null)).toBe(
      '<meta charset="windows-1252"><p>“q”</p>',
    );
  });

  it('follows a byte order mark first and drops it', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi', 'utf16le')]);

    expect(decodeText(utf16, 'text/html; charset=utf-8')).toBe('hi');
    expect(decodeText(Buffer.from('﻿hi', 'utf8'), null)).toBe('hi');
  });

  it('reads UTF-8 when the named character set is unknown', () => {
    expect(decodeText(Buffer.from('é', 'utf8'), 'text/html; charset=no-such-set')).toBe('é');
  });
});
