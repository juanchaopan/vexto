import { errorResponse, type JsonResponse } from '../../lib/http-server.ts';

/**
 * Handles `POST /synthesize` of the vexto-tts service (.docs/design/interfaces.md). Synthesis is
 * not built yet, so every request is answered with 501 without reading it.
 */
export function synthesize(): JsonResponse {
  return errorResponse(501, 'NOT_IMPLEMENTED', 'Speech synthesis is not available yet.', false);
}
