import { handleMemberRequest } from '../../../../../../../features/account/index.ts';
import {
  cardExamplePath,
  operationRequest,
  refreshCardExampleResult,
} from '../../../../../../../features/vocabulary/index.ts';
import { readJsonBody } from '../../../../../../../lib/api/route.ts';

// The member is checked first, then the path's IDs, then the body.
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; exampleId: string }> },
): Promise<Response> {
  return handleMemberRequest(async ({ member, requestId }) => {
    const path = cardExamplePath(await params);
    const { operationId } = await readJsonBody(request, operationRequest);
    return refreshCardExampleResult({ ownerId: member.id, requestId }, { ...path, operationId });
  });
}
