import { handleMemberRequest } from '../../../../features/account/index.ts';
import { nextQuestionResult } from '../../../../features/review/index.ts';

export function GET(request: Request): Promise<Response> {
  return handleMemberRequest(({ member }) =>
    nextQuestionResult(member.id, new URL(request.url).searchParams),
  );
}
