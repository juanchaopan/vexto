/** An email address of a sign-in account, as the identity provider reports it. */
export type AccountEmail = {
  id: string;
  address: string;
  verified: boolean;
};

/**
 * The addresses a member row may be bound by (.docs/design/rules.md, 成员和登录): only verified
 * ones, lower-cased as the members table stores them, the primary address first and no address
 * twice.
 */
export function verifiedEmails(
  emails: readonly AccountEmail[],
  primaryId: string | null,
): string[] {
  const ordered = [...emails].sort(
    (a, b) => Number(b.id === primaryId) - Number(a.id === primaryId),
  );
  const addresses = ordered
    .filter((email) => email.verified)
    .map((email) => email.address.trim().toLowerCase())
    .filter((address) => address.length > 0);
  return [...new Set(addresses)];
}
