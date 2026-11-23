// The stand-in for OpenAI the end-to-end run points the application at (OPENAI_BASE_URL), since
// the built application runs as its own process where MSW cannot reach it and the tests must
// never call the real service. It answers `POST /v1/responses` like the Responses API, by the name
// of the structured output the request asks for:
//   - a lookup gets the prototype's explanation of the word when it has one and a plain made-up
//     one otherwise;
//   - a new example request gets a new sentence each time;
//   - the same-meaning check of a save names the saved meaning that is written like the new one
//     or is one of the prototype's two meanings of `resilient`, or none;
//   - the Translate options of a save get three fixed wrong meanings.
// `GET /health` tells Playwright it is up.
// Usage: node e2e/support/openai-double.ts <port>
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type Explanation = {
  lemma: string;
  pos: string;
  meaningZh: string;
  examples: string[];
  acceptedForms: string[];
};

// The explanations the confirmed prototype shows (.docs/design/screens, screens 21–27).
const KNOWN: Record<string, Explanation> = {
  resilient: {
    lemma: 'resilient',
    pos: 'adjective',
    meaningZh: '有韧性的；经得起损耗的',
    examples: [
      'The new coating keeps the camera resilient in harsh desert conditions.',
      'Resilient materials return to their shape after being bent or pressed.',
    ],
    acceptedForms: ['resilient'],
  },
  coating: {
    lemma: 'coating',
    pos: 'noun',
    meaningZh: '涂层；覆盖层',
    examples: [
      'A thin coating of wax protects the wooden table from water.',
      'The coating on the lens reduces glare in bright sunlight.',
    ],
    acceptedForms: ['coating', 'coatings'],
  },
  adapt: {
    lemma: 'adapt',
    pos: 'verb',
    meaningZh: '使适应；调整',
    examples: [
      'Teams often adapt their plans when the weather changes suddenly.',
      'The cooks had to adapt the recipe for a much smaller oven.',
    ],
    acceptedForms: ['adapt', 'adapts', 'adapted', 'adapting'],
  },
  dust: {
    lemma: 'dust',
    pos: 'noun',
    meaningZh: '灰尘；尘土',
    examples: [
      'A layer of dust covered the old piano in the attic.',
      'Wind carried red dust across the dry fields all afternoon.',
    ],
    acceptedForms: ['dust'],
  },
  sticky: {
    lemma: 'sticky',
    pos: 'adjective',
    meaningZh: '黏的；黏性的',
    examples: [
      'The jam left a sticky mark on the kitchen table.',
      'Warm, sticky air made the long walk feel even longer.',
    ],
    acceptedForms: ['sticky'],
  },
};

/**
 * Meanings that count as the same: the saved `resilient` of the demo account and the one its
 * lookup explains, so saving the lookup offers to replace the saved word (screen 29).
 */
const SAME_MEANINGS = [['有适应力的；能迅速恢复的', '有韧性的；经得起损耗的']];

function sameMeaning(saved: string, explained: string | undefined): boolean {
  return (
    saved === explained ||
    SAME_MEANINGS.some((group) => group.includes(saved) && group.includes(explained ?? ''))
  );
}

/** The wrong Translate options of every saved word. */
const DISTRACTORS = ['迅速消失的', '令人厌烦的', '非常昂贵的'];

function madeUp(selection: string): Explanation {
  const word = selection.toLowerCase();
  return {
    lemma: word,
    pos: 'phrase',
    meaningZh: '所选词语在当前句子中的含义',
    examples: [
      `In this situation, ${word} is a useful word to remember.`,
      `Teachers often explain ${word} with a short story about daily life.`,
    ],
    acceptedForms: [word],
  };
}

let examples = 0;

type Request = {
  model: string;
  input: { content: string }[];
  text: { format: { name: string } };
};

type Data = Record<string, unknown>;

const answers: Record<string, (data: Data) => unknown> = {
  new_example(data) {
    examples += 1;
    const form = (data.acceptedForms as string[] | undefined)?.[0] ?? 'word';
    return {
      example: `Story ${examples} shows how a ${form} idea can help people every single day.`,
    };
  },
  meaning_match(data) {
    const word = data.word as { meaningZh?: string } | undefined;
    const saved = (data.savedMeanings as { number: number; meaningZh: string }[] | undefined) ?? [];
    return {
      sameMeaning: saved.find((one) => sameMeaning(one.meaningZh, word?.meaningZh))?.number ?? 0,
    };
  },
  translation_options: () => ({ distractors: DISTRACTORS }),
};

function answerOf(request: Request): unknown {
  const data = JSON.parse(request.input[0]?.content ?? '{}') as Data;
  const answer = answers[request.text.format.name];
  if (answer) {
    return answer(data);
  }
  const selection = String(data.selection ?? '');
  return KNOWN[selection.toLowerCase()] ?? madeUp(selection);
}

function responseOf(request: Request) {
  return {
    id: `resp_${randomUUID()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: request.model,
    output: [
      {
        type: 'message',
        id: `msg_${randomUUID()}`,
        status: 'completed',
        role: 'assistant',
        content: [
          { type: 'output_text', text: JSON.stringify(answerOf(request)), annotations: [] },
        ],
      },
    ],
    usage: {
      input_tokens: 600,
      output_tokens: 120,
      total_tokens: 720,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'x-request-id': `req_${randomUUID()}`,
  });
  response.end(JSON.stringify(body));
}

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error('Usage: node e2e/support/openai-double.ts <port>');
  process.exit(1);
}

createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/responses') {
    send(response, 404, { error: { message: 'Not found.' } });
    return;
  }
  bodyOf(request)
    .then((text) => send(response, 200, responseOf(JSON.parse(text) as Request)))
    .catch(() => send(response, 400, { error: { message: 'The request is not JSON.' } }));
}).listen(port, '127.0.0.1');
