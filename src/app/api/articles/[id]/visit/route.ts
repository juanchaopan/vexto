import { handleMemberRequest } from '../../../../../features/account/index.ts';
import { visitResult } from '../../../../../features/reading/index.ts';

// The visit has no body; whatever a request sends is ignored.
export function PUT(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleMemberRequest(async ({ member }) => visitResult(member.id, (await params).id));
}
