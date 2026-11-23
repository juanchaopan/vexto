// Turns a fetched body into text. The character set comes from a byte order mark, the charset of
// the Content-Type header, or the XML declaration or HTML meta tag near the start of the body, in
// that order; a body that names none, or names one that is not known, is read as UTF-8.

const SNIFF_BYTES = 2048;

function fromBom(body: Uint8Array): string | null {
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
    return 'utf-8';
  }
  if (body[0] === 0xff && body[1] === 0xfe) {
    return 'utf-16le';
  }
  return body[0] === 0xfe && body[1] === 0xff ? 'utf-16be' : null;
}

function fromContentType(contentType: string | null): string | null {
  return /;\s*charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType ?? '')?.[1] ?? null;
}

function fromDocument(body: Uint8Array): string | null {
  const head = Buffer.from(body.subarray(0, SNIFF_BYTES)).toString('latin1');
  const declared =
    /<\?xml[^>]*\sencoding\s*=\s*["']([\w.:-]+)["']/i.exec(head) ??
    /<meta[^>]*\scharset\s*=\s*["']?([\w.:-]+)/i.exec(head);
  return declared?.[1] ?? null;
}

function decoderFor(label: string | null): TextDecoder {
  try {
    return new TextDecoder(label ?? 'utf-8');
  } catch {
    return new TextDecoder('utf-8');
  }
}

/** The body as text, in the character set it declares. */
export function decodeText(body: Uint8Array, contentType: string | null): string {
  const label = fromBom(body) ?? fromContentType(contentType) ?? fromDocument(body);
  return decoderFor(label).decode(body);
}
