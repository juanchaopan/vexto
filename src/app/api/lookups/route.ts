import { handleMemberRequest } from '../../../features/account/index.ts';
import { lookupRequest, lookupResult } from '../../../features/lookup/index.ts';
import { cardSources } from '../../../features/vocabulary/index.ts';
import { readJsonBody } from '../../../lib/api/route.ts';

// The member is checked before the body is read. Lookups made in card details and reviews read
// their context from the member's cards, which the vocabulary feature provides.
export function POST(request: Request): Promise<Response> {
  return handleMemberRequest(async ({ member, requestId }) =>
    lookupResult({ ownerId: member.id, requestId }, await readJsonBody(request, lookupRequest), {
      cards: cardSources,
    }),
  );
}
