import { handleMemberRequest } from '../../../features/account/index.ts';
import { articleListResult } from '../../../features/reading/index.ts';

export function GET(request: Request): Promise<Response> {
  return handleMemberRequest(({ member }) =>
    articleListResult(member.id, new URL(request.url).searchParams),
  );
}
