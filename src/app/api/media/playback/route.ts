import { handleMemberRequest } from '../../../../features/account/index.ts';
import { playbackRequest, playbackResult } from '../../../../features/media/index.ts';
import { readJsonBody } from '../../../../lib/api/route.ts';

// The member is checked before the body is read, so a request without a session or a member is
// refused whatever it sends.
export function POST(request: Request): Promise<Response> {
  return handleMemberRequest(async ({ member }) =>
    playbackResult(member.id, await readJsonBody(request, playbackRequest)),
  );
}
