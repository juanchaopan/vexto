// Entry of the Cloud Run service vexto-tts, which synthesizes the speech of words and example
// sentences on request (.docs/design/interfaces.md). Cloud Run checks the caller's identity
// before a request reaches it. The speech model starts loading as soon as the service listens,
// so a request that wakes the service waits only for what is left of the load.
// Run with: node src/worker/tts.ts   (listens on PORT, 8080 by default; reads MODEL_DIR and S3_*)
import { synthesisServiceFromEnv, type SynthesisService } from '../features/speech/index.ts';
import { createJsonServer, health, serve } from '../lib/http-server.ts';

export function createTtsServer(service: SynthesisService) {
  return createJsonServer({
    'GET /health': health,
    'POST /synthesize': (request) => service.synthesize(request),
  });
}

if (import.meta.main) {
  const service = synthesisServiceFromEnv();
  await serve(createTtsServer(service), 'vexto-tts');
  void service.warmUp();
}
