// Entry of the Cloud Run service vexto-tts, which synthesizes the speech of words and example
// sentences on request (.docs/design/interfaces.md). Cloud Run checks the caller's identity
// before a request reaches it.
// Run with: node src/worker/tts.ts   (listens on PORT, 8080 by default)
import { synthesize } from '../features/speech/index.ts';
import { createJsonServer, health, serve } from '../lib/http-server.ts';

export function createTtsServer() {
  return createJsonServer({
    'GET /health': health,
    'POST /synthesize': synthesize,
  });
}

if (import.meta.main) {
  await serve(createTtsServer(), 'vexto-tts');
}
