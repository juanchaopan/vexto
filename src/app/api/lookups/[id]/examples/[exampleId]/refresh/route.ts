import { handleMemberRequest } from '../../../../../../../features/account/index.ts';
import {
  refreshExampleRequest,
  refreshExampleResult,
  refreshPath,
} from '../../../../../../../features/lookup/index.ts';
import { readJsonBody } from '../../../../../../../lib/api/route.ts';

// The member is checked first, then the path's IDs, then the body.
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; exampleId: string }> },
): Promise<Response> {
  return handleMemberRequest(async ({ member, requestId }) => {
    const path = refreshPath(await params);
    const { operationId } = await readJsonBody(request, refreshExampleRequest);
    return refreshExampleResult({ ownerId: member.id, requestId }, { ...path, operationId });
  });
}
