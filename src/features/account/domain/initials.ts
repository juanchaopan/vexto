/**
 * The letters on the avatar button (.docs/design/screens.md, 顶栏): the first letter of each word
 * of the person's name, at most two, upper-case. Without a name the email address stands in, so
 * the button always shows something.
 */
export function initialsOf(name: string | null | undefined, email: string | null | undefined) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return words
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join('')
      .toUpperCase();
  }
  const first = Array.from((email ?? '').trim())[0];
  return first ? first.toUpperCase() : '';
}
