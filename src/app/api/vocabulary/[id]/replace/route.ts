import { handleMemberRequest } from '../../../../../features/account/index.ts';
import {
  cardPathId,
  replaceCardResult,
  replaceRequest,
} from '../../../../../features/vocabulary/index.ts';
import { readJsonBody } from '../../../../../lib/api/route.ts';

// The member is checked first, then the path's ID, then the body.
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleMemberRequest(async ({ member, requestId }) => {
    const cardId = cardPathId((await params).id);
    const body = await readJsonBody(request, replaceRequest);
    return replaceCardResult({ ownerId: member.id, requestId }, { cardId, ...body });
  });
}
