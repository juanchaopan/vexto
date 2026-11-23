// The account and terms endpoints (.docs/design/interfaces.md, 账号和条款): reading one's own
// profile, and accepting the terms version the person saw.
import { z } from 'zod';
import { ApiError } from '../../../lib/api/errors.ts';
import { dataResult, type ApiResult } from '../../../lib/api/responses.ts';
import { getDatabase } from '../../../lib/db/client.ts';
import { sharedConfig } from '../../../lib/config/shared-config.ts';
import { termsStatus } from '../domain/terms.ts';
import type { Member } from './member-records.ts';
import { recordTermsAcceptance } from './member-records.ts';

/** `GET /api/me`: `{ email, terms: { currentVersion, acceptedVersion, acceptedAt } }`. */
export function profileResult(member: Member): ApiResult {
  return dataResult({
    email: member.email,
    terms: termsStatus(member, sharedConfig.terms.version),
  });
}

/** The body of `POST /api/terms/acceptance`: the version of the terms the person saw. */
export const termsAcceptanceRequest = z.strictObject({
  version: z.number().int().min(1).max(2_147_483_647),
});

export type TermsAcceptanceRequest = z.infer<typeof termsAcceptanceRequest>;

/**
 * `POST /api/terms/acceptance`: records the acceptance and answers
 * `{ acceptedVersion, acceptedAt }`. Only the current version can be accepted; accepting it again
 * answers the original time.
 */
export async function acceptTermsResult(
  member: Member,
  request: TermsAcceptanceRequest,
): Promise<ApiResult> {
  const current = sharedConfig.terms.version;
  if (request.version !== current) {
    throw new ApiError('CONFLICT', `Version ${current} is the current version of the terms.`);
  }
  const acceptance = await recordTermsAcceptance(getDatabase(), member.id, current);
  if (!acceptance) {
    throw new ApiError('NOT_A_MEMBER', 'This account is not on the member list.');
  }
  return dataResult({
    acceptedVersion: acceptance.termsVersion,
    acceptedAt: acceptance.termsAcceptedAt,
  });
}
