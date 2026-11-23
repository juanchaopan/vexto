import { handleMemberRequest } from '../../../../features/account/index.ts';
import { articleIdsResult } from '../../../../features/reading/index.ts';

export function GET(request: Request): Promise<Response> {
  return handleMemberRequest(({ member }) =>
    articleIdsResult(member.id, new URL(request.url).searchParams),
  );
}
