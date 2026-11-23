import { handleMemberRequest } from '../../../../features/account/index.ts';
import {
  cardPathId,
  cardResult,
  deleteCardResult,
  operationRequest,
} from '../../../../features/vocabulary/index.ts';
import { readJsonBody } from '../../../../lib/api/route.ts';

type Context = { params: Promise<{ id: string }> };

// The member is checked first, then the path's ID, then the body.
export function GET(_request: Request, { params }: Context): Promise<Response> {
  return handleMemberRequest(async ({ member }) =>
    cardResult(member.id, cardPathId((await params).id)),
  );
}

export function DELETE(request: Request, { params }: Context): Promise<Response> {
  return handleMemberRequest(async ({ member, requestId }) => {
    const cardId = cardPathId((await params).id);
    const { operationId } = await readJsonBody(request, operationRequest);
    return deleteCardResult({ ownerId: member.id, requestId }, { cardId, operationId });
  });
}
