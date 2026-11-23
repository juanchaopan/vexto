// The terms of use (.docs/design/terms.md): the current version is an integer in the shared
// configuration, and a member may use the application only after accepting exactly that version.

/** A member's recorded acceptance; both are empty until the first acceptance. */
export type TermsAcceptance = {
  termsVersion: number | null;
  termsAcceptedAt: Date | null;
};

/** What `GET /api/me` tells about the terms. */
export type TermsStatus = {
  currentVersion: number;
  acceptedVersion: number | null;
  acceptedAt: Date | null;
};

export function termsStatus(acceptance: TermsAcceptance, currentVersion: number): TermsStatus {
  return {
    currentVersion,
    acceptedVersion: acceptance.termsVersion,
    acceptedAt: acceptance.termsAcceptedAt,
  };
}

/** True once the member accepted the current version; an older version counts as not accepted. */
export function hasAcceptedTerms(acceptance: TermsAcceptance, currentVersion: number): boolean {
  return acceptance.termsVersion === currentVersion && acceptance.termsAcceptedAt !== null;
}

/**
 * The date of a terms version as the terms page writes it, `November 22, 2026`, from the
 * configuration's ISO date. The date is a calendar day, so it is read and written in UTC and
 * shows the same day on every device.
 */
export function termsDateText(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}
