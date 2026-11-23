import {
  acceptTermsResult,
  handleMemberRequest,
  termsAcceptanceRequest,
} from '../../../../features/account/index.ts';
import { readJsonBody } from '../../../../lib/api/route.ts';

// Accepting the terms works before they are accepted, by definition. The member is checked
// before the body is read, so a request without a session is refused whatever it sends.
export function POST(request: Request): Promise<Response> {
  return handleMemberRequest(
    async ({ member }) =>
      acceptTermsResult(member, await readJsonBody(request, termsAcceptanceRequest)),
    { terms: 'not-required' },
  );
}
