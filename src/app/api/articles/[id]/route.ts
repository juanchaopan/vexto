import { handleMemberRequest } from '../../../../features/account/index.ts';
import { articleResult } from '../../../../features/reading/index.ts';

export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleMemberRequest(async () => articleResult((await params).id));
}
