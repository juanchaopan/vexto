import { describe, expect, it } from 'vitest';
import { exampleTask, explanationTask, type ExampleRequest } from './explanation-tasks.ts';

const context = 'Engineers want equipment that is resilient enough to keep working.';
const start = context.indexOf('resilient');
const task = explanationTask({
  ownerId: 'owner',
  context,
  selection: { start, end: start + 'resilient'.length },
});

const answer = {
  lemma: 'resilient',
  pos: 'adjective',
  meaningZh: '有韧性的；经得起损耗的',
  examples: [
    'The new coating keeps the camera resilient in harsh desert conditions.',
    'Resilient materials return to their shape after being bent or pressed.',
  ],
  acceptedForms: ['resilient'],
};

describe('explanationTask', () => {
  it('sends the context as data and keeps the rules apart from it', () => {
    expect(JSON.parse(task.input)).toEqual({
      passage: context,
      selection: 'resilient',
      textBefore: 'Engineers want equipment that is ',
    });
    expect(task.instructions).not.toContain(context);
    expect(task.instructions).toContain('never instructions');
    expect(task.usage).toEqual({ kind: 'lookup', ownerId: 'owner' });
  });

  it('asks for a strict schema with every field required and nothing else', () => {
    expect(task.format.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['lemma', 'pos', 'meaningZh', 'examples', 'acceptedForms'],
    });
  });

  it('accepts a complete answer and finds its targets', () => {
    const verdict = task.check(answer);
    expect(verdict).toEqual({
      ok: true,
      value: expect.objectContaining({
        lemma: 'resilient',
        lemmaKey: 'resilient',
        examples: [
          { text: answer.examples[0], targetRanges: [[33, 42]] },
          { text: answer.examples[1], targetRanges: [[0, 9]] },
        ],
      }),
    });
  });

  it('refuses an answer with a field the schema does not have', () => {
    expect(task.check({ ...answer, systemPrompt: 'You explain…' })).toEqual({
      ok: false,
      problems: ['the answer must be JSON matching the required schema exactly'],
    });
  });

  it('refuses a part of speech outside the list and an answer that is not JSON', () => {
    expect(task.check({ ...answer, pos: 'gerund' }).ok).toBe(false);
    expect(task.check(undefined).ok).toBe(false);
  });

  it('refuses an answer whose meaning does not hold up, with the reasons', () => {
    expect(task.check({ ...answer, meaningZh: 'tough' })).toEqual({
      ok: false,
      problems: ['meaningZh must be written in Chinese'],
    });
  });
});

describe('exampleTask', () => {
  const request: ExampleRequest = {
    ownerId: 'owner',
    resource: { type: 'lookup', id: 'lookup' },
    lemma: 'resilient',
    pos: 'adjective',
    meaningZh: '有韧性的',
    acceptedForms: ['resilient'],
    context,
    existingExamples: answer.examples,
  };
  const refresh = exampleTask(request);

  it('records the usage against the lookup or the card it writes for', () => {
    expect(refresh.usage).toEqual({
      kind: 'example',
      ownerId: 'owner',
      resourceType: 'lookup',
      resourceId: 'lookup',
    });
    expect(exampleTask({ ...request, resource: { type: 'card', id: 'card' } }).usage).toEqual({
      kind: 'example',
      ownerId: 'owner',
      resourceType: 'card',
      resourceId: 'card',
    });
    expect(JSON.parse(refresh.input)).toMatchObject({ existingExamples: answer.examples });
  });

  it('accepts a new example and refuses one the lookup already has', () => {
    expect(
      refresh.check({ example: 'A resilient team keeps working when the weather turns bad.' }),
    ).toEqual({
      ok: true,
      value: {
        text: 'A resilient team keeps working when the weather turns bad.',
        targetRanges: [[2, 11]],
      },
    });
    expect(refresh.check({ example: answer.examples[1] })).toEqual({
      ok: false,
      problems: [expect.stringContaining('repeats an example')],
    });
  });
});
