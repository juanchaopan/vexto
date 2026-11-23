import { handleMemberRequest } from '../../../../features/account/index.ts';
import { submitAnswerResult, submitRequest } from '../../../../features/review/index.ts';
import { readJsonBody } from '../../../../lib/api/route.ts';

// The member is checked before the body is read.
export function POST(request: Request): Promise<Response> {
  return handleMemberRequest(async ({ member, requestId }) =>
    submitAnswerResult(
      { ownerId: member.id, requestId },
      await readJsonBody(request, submitRequest),
    ),
  );
}
