import { handleMemberRequest } from '../../../../features/account/index.ts';
import { bulkDeleteRequest, bulkDeleteResult } from '../../../../features/vocabulary/index.ts';
import { readJsonBody } from '../../../../lib/api/route.ts';

// The member is checked before the body is read.
export function POST(request: Request): Promise<Response> {
  return handleMemberRequest(async ({ member, requestId }) =>
    bulkDeleteResult(
      { ownerId: member.id, requestId },
      await readJsonBody(request, bulkDeleteRequest),
    ),
  );
}
