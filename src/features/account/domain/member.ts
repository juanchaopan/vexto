/** A member is `active` while invited and `revoked` once removed from the list. */
export const MEMBER_STATUSES = ['active', 'revoked'] as const;

export type MemberStatus = (typeof MEMBER_STATUSES)[number];
