// The license text laid out for a phone (.docs/design/screens.md, 许可证): the words stay as they
// are, but the hard line breaks inside a paragraph become spaces, and a few lines are shown as
// headings. The terms page takes its use restrictions (a)–(m) from the same blocks.

export type LicenseBlock = { text: string; heading: boolean };

// A line that starts a new block even without a blank line before it: a list item, a numbered
// clause, a section title, or the sentence that opens the use restrictions.
const blockStart =
  /^(\([a-z]\)|[a-z]\.\s|\d+\.\s|Section [IVX]+:|Attachment A$|Use Restrictions$|END OF TERMS|NOW THEREFORE|You agree not to use)/;

const headingLine =
  /^(BigScience Open RAIL-M License|Section [IVX]+:|Attachment A$|Use Restrictions$|END OF TERMS)/;

const restrictionsIntro = 'You agree not to use';
const restrictionItem = /^\(([a-m])\)\s*/;

/** Splits the license into paragraphs and headings, joining the lines of each paragraph. */
export function licenseBlocks(text: string): LicenseBlock[] {
  const blocks: { text: string }[] = [];
  let current: { text: string } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      current = null;
    } else if (!current || blockStart.test(line)) {
      current = { text: line };
      blocks.push(current);
    } else {
      current.text += ` ${line}`;
    }
  }
  return blocks.map((block) => ({ text: block.text, heading: headingLine.test(block.text) }));
}

export type RestrictionList = {
  /** The sentence the list hangs from: `You agree not to use the Model or Derivatives of the Model:`. */
  intro: string;
  /** Each restriction as its letter, such as `(a)`, and its text. */
  items: { letter: string; text: string }[];
};

/** The use restrictions of Attachment A, read from the license blocks. */
export function restrictionsOf(blocks: readonly LicenseBlock[]): RestrictionList {
  const from = blocks.findIndex((block) => block.text.startsWith(restrictionsIntro));
  if (from < 0) {
    throw new Error('The license text has no use restrictions.');
  }
  const items = blocks.slice(from + 1).flatMap((block) => {
    const match = restrictionItem.exec(block.text);
    return match ? [{ letter: `(${match[1]})`, text: block.text.slice(match[0].length) }] : [];
  });
  return { intro: blocks[from].text, items };
}
