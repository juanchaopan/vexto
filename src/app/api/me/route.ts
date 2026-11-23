import { handleMemberRequest, profileResult } from '../../../features/account/index.ts';

// The signed-in member's own profile; it works before the current terms are accepted, since the
// browser reads it to decide whether to show the terms page.
export function GET(): Promise<Response> {
  return handleMemberRequest(async ({ member }) => profileResult(member), {
    terms: 'not-required',
  });
}
