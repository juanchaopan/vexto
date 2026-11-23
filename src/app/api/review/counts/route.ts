import { handleMemberRequest } from '../../../../features/account/index.ts';
import { reviewCountsResult } from '../../../../features/review/index.ts';

export function GET(): Promise<Response> {
  return handleMemberRequest(({ member }) => reviewCountsResult(member.id));
}
