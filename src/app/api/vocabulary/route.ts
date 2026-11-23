import { handleMemberRequest } from '../../../features/account/index.ts';
import {
  saveCardResult,
  saveRequest,
  vocabularyListResult,
} from '../../../features/vocabulary/index.ts';
import { readJsonBody } from '../../../lib/api/route.ts';

export function GET(request: Request): Promise<Response> {
  return handleMemberRequest(({ member }) =>
    vocabularyListResult(member.id, new URL(request.url).searchParams),
  );
}

// The member is checked before the body is read.
export function POST(request: Request): Promise<Response> {
  return handleMemberRequest(async ({ member, requestId }) =>
    saveCardResult({ ownerId: member.id, requestId }, await readJsonBody(request, saveRequest)),
  );
}
