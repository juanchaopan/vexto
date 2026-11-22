import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './collect.ts';

const collection = vi.hoisted(() => ({ runCollection: vi.fn(async () => undefined) }));

vi.mock('../features/collection/index.ts', () => collection);

let logged: Record<string, unknown>[];

beforeEach(() => {
  logged = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    logged.push(JSON.parse(String(chunk)) as Record<string, unknown>);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('vexto-collect', () => {
  it('runs the collection once and logs its start and finish', async () => {
    expect(await main()).toBe(0);

    expect(collection.runCollection).toHaveBeenCalledOnce();
    expect(logged.map((entry) => [entry.severity, entry.message])).toEqual([
      ['INFO', 'vexto-collect started.'],
      ['INFO', 'vexto-collect finished.'],
    ]);
    expect(logged[1].durationMs).toEqual(expect.any(Number));
  });

  it('exits with 1 and logs the error when the run itself fails', async () => {
    collection.runCollection.mockRejectedValueOnce(new Error('database unreachable'));

    expect(await main()).toBe(1);

    expect(logged.at(-1)).toMatchObject({
      severity: 'ERROR',
      message: 'vexto-collect failed.',
      error: 'database unreachable',
    });
  });
});
