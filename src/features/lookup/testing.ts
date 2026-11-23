// Test kit for lookups. Only test files import this module.
//
// - openAiDouble(): MSW in front of the network, answering `POST /v1/responses` at
//   TEST_OPENAI_BASE_URL like the OpenAI Responses API does. By default it explains the selection
//   of a lookup and writes a new example for a refresh, from the request's own data; other
//   features add default answers for their own tasks by the structured output's name. A test can
//   queue other answers (any JSON, an error status or a delay) for the next calls. It records
//   every request. Point the code at it with stubOpenAiEnv() before the first lookup of the file.
// - fixedExplanation(): the answer the double gives for a selection.
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const TEST_OPENAI_BASE_URL = 'http://openai.test/v1';

/** Points the OpenAI client at the double, with a key that is not a real one. */
export function stubOpenAiEnv(): void {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-not-a-real-key');
  vi.stubEnv('OPENAI_BASE_URL', TEST_OPENAI_BASE_URL);
}

export type ResponsesRequest = {
  model: string;
  instructions: string;
  input: { role: string; content: string }[];
  text: { format: { type: string; name: string; schema: unknown; strict: boolean } };
  reasoning?: { effort: string };
  max_output_tokens?: number;
  store?: boolean;
  tools?: unknown;
};

/** What the double answers with: model output as JSON, an HTTP error, or a wait first. */
export type DoubleAnswer =
  | { output: unknown; inputTokens?: number; outputTokens?: number }
  | { status: number }
  | { delayMs: number; then?: DoubleAnswer };

/** A default answer of a task, made from the data its request sent. */
export type DefaultAnswer = (data: Record<string, unknown>) => unknown;

export const TEST_USAGE = { inputTokens: 812, outputTokens: 96 };

/** The explanation the double gives: the selection as its own lemma, in two fixed examples. */
export function fixedExplanation(selection: string) {
  const lemma = selection.toLowerCase();
  return {
    lemma,
    pos: 'adjective',
    meaningZh: '有韧性的；经得起损耗的',
    examples: [
      `The new coating keeps the camera ${lemma} in harsh desert conditions.`,
      `Engineers tested how ${lemma} the panels stayed after a long winter.`,
    ],
    acceptedForms: [lemma],
  };
}

function userData(body: ResponsesRequest): Record<string, unknown> {
  try {
    return JSON.parse(body.input[0]?.content ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

let refreshCount = 0;

const lookupAnswers: Record<string, DefaultAnswer> = {
  new_example(data) {
    refreshCount += 1;
    const forms = (data.acceptedForms as string[] | undefined) ?? ['word'];
    return {
      example: `Number ${refreshCount} shows how a ${forms[0]} material keeps its shape in the cold.`,
    };
  },
  word_explanation: (data) => fixedExplanation(String(data.selection ?? '')),
};

function responseBody(
  body: ResponsesRequest,
  answer: { output: unknown } & Partial<typeof TEST_USAGE>,
) {
  return {
    id: `resp_${randomUUID()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: body.model,
    output: [
      {
        type: 'message',
        id: `msg_${randomUUID()}`,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify(answer.output), annotations: [] }],
      },
    ],
    usage: {
      input_tokens: answer.inputTokens ?? TEST_USAGE.inputTokens,
      output_tokens: answer.outputTokens ?? TEST_USAGE.outputTokens,
      total_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

export type OpenAiDoubleOptions = {
  /** Default answers of other tasks, by the name of their structured output. */
  defaults?: Record<string, DefaultAnswer>;
};

export function openAiDouble({ defaults = {} }: OpenAiDoubleOptions = {}) {
  const requests: ResponsesRequest[] = [];
  const queued: DoubleAnswer[] = [];
  const answers = { ...lookupAnswers, ...defaults };

  /** The answer the double makes from the request itself. */
  const defaultOutput = (body: ResponsesRequest): unknown => {
    const answer = answers[body.text.format.name] ?? lookupAnswers.word_explanation;
    return answer(userData(body));
  };

  const respond = async (body: ResponsesRequest, answer: DoubleAnswer): Promise<Response> => {
    if ('delayMs' in answer) {
      await delay(answer.delayMs);
      return respond(body, answer.then ?? { output: defaultOutput(body) });
    }
    const headers = { 'x-request-id': `req_${randomUUID()}` };
    if ('status' in answer) {
      return HttpResponse.json(
        { error: { message: 'The test double refused.', type: 'test_error' } },
        { status: answer.status, headers },
      );
    }
    return HttpResponse.json(responseBody(body, answer), { headers });
  };

  const server = setupServer(
    http.post(`${TEST_OPENAI_BASE_URL}/responses`, async ({ request }) => {
      const body = (await request.json()) as ResponsesRequest;
      requests.push(body);
      return respond(body, queued.shift() ?? { output: defaultOutput(body) });
    }),
  );
  return {
    server,
    requests,
    /** Answers the next calls with these, in order; later calls get the default answer. */
    answerNext(...answers: DoubleAnswer[]) {
      queued.push(...answers);
    },
    /** Forgets the requests and the queued answers. */
    reset() {
      requests.length = 0;
      queued.length = 0;
    },
  };
}

/** The data a request sent as its user message. */
export function sentData(request: ResponsesRequest): Record<string, unknown> {
  return userData(request);
}
