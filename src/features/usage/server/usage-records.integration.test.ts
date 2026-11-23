import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { aiConfig } from '../../../lib/config/ai-config.ts';
import { priceConfig } from '../../../lib/config/price-config.ts';
import { speechConfig } from '../../../lib/config/speech-config.ts';
import { closeDatabase, getDatabase } from '../../../lib/db/client.ts';
import { members } from '../../account/index.ts';
import { usageRecords } from './schema.ts';
import {
  finishUsage,
  pricedOutcome,
  startUsage,
  trackUsage,
  type UsageStart,
} from './usage-records.ts';

// Each test names a model or resource of its own, so it finds exactly the records it wrote.

const db = getDatabase();

afterAll(async () => {
  await closeDatabase();
});

function lookupCall(): UsageStart {
  return { kind: 'lookup', provider: 'openai', model: `model-${randomUUID()}` };
}

/** A call to the configured model, told apart by a resource of its own. */
function pricedLookupCall(): UsageStart {
  return {
    kind: 'lookup',
    provider: aiConfig.provider,
    model: aiConfig.model,
    resourceType: 'lookup',
    resourceId: randomUUID(),
  };
}

async function record(id: string) {
  const [row] = await db.select().from(usageRecords).where(eq(usageRecords.id, id));
  return row;
}

async function recordsOf(model: string) {
  return db.select().from(usageRecords).where(eq(usageRecords.model, model));
}

async function recordsFor(resourceId: string) {
  return db.select().from(usageRecords).where(eq(usageRecords.resourceId, resourceId));
}

describe('startUsage and finishUsage', () => {
  it('write a pending record before the call and complete it after', async () => {
    const [member] = await db
      .insert(members)
      .values({ email: `usage-${randomUUID()}@example.com`, status: 'active' })
      .returning({ id: members.id });
    const call = lookupCall();
    const resourceId = randomUUID();

    const id = await startUsage(db, {
      ...call,
      ownerId: member.id,
      resourceType: 'lookup',
      resourceId,
    });
    const pending = await record(id);

    expect(pending).toMatchObject({
      kind: 'lookup',
      provider: 'openai',
      model: call.model,
      status: 'pending',
      ownerId: member.id,
      resourceType: 'lookup',
      resourceId,
      finishedAt: null,
      inputTokens: null,
    });
    expect(pending.startedAt).toBeInstanceOf(Date);

    await finishUsage(db, id, {
      status: 'succeeded',
      requestId: 'req_provider_1',
      inputTokens: 812,
      outputTokens: 96,
      estimatedCost: '0.000420',
      priceVersion: 'test-prices-1',
    });
    const finished = await record(id);

    expect(finished).toMatchObject({
      status: 'succeeded',
      requestId: 'req_provider_1',
      inputTokens: 812,
      outputTokens: 96,
      estimatedCost: '0.000420',
      priceVersion: 'test-prices-1',
      audioMs: null,
      cpuMs: null,
    });
    expect(finished.finishedAt?.getTime()).toBeGreaterThanOrEqual(pending.startedAt.getTime());
  });

  it('record the collection job’s speech without an owner', async () => {
    const id = await startUsage(db, {
      kind: 'article_tts',
      provider: 'supertonic',
      model: 'supertonic-3',
      engineRevision: 'aafc6e32416a594460b32413efc49d7fe4ce6d46',
    });
    await finishUsage(db, id, {
      status: 'succeeded',
      audioMs: 300_000,
      cpuMs: 680_000,
      byteCount: 1_200_000,
    });

    expect(await record(id)).toMatchObject({
      ownerId: null,
      engineRevision: 'aafc6e32416a594460b32413efc49d7fe4ce6d46',
      audioMs: 300_000,
      cpuMs: 680_000,
      byteCount: 1_200_000,
    });
  });
});

describe('trackUsage', () => {
  it('keeps a pending record during the call and completes it with the call’s usage', async () => {
    const call = lookupCall();
    let statusDuringCall: string | undefined;

    const result = await trackUsage(
      db,
      call,
      async () => {
        statusDuringCall = (await recordsOf(call.model))[0]?.status;
        return { result: 'explained', outcome: { status: 'succeeded', inputTokens: 10 } };
      },
      () => ({ status: 'failed' }),
    );

    expect(result).toBe('explained');
    expect(statusDuringCall).toBe('pending');
    expect(await recordsOf(call.model)).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        inputTokens: 10,
        outputTokens: null,
        estimatedCost: null,
        priceVersion: null,
      }),
    ]);
  });

  it('records the outcome of a call that throws, leaves its usage unknown and throws on', async () => {
    const call = lookupCall();
    const timeout = new Error('timed out');

    await expect(
      trackUsage(
        db,
        call,
        async () => {
          throw timeout;
        },
        (error) => ({ status: 'unknown', errorCode: error === timeout ? 'timeout' : 'other' }),
      ),
    ).rejects.toBe(timeout);

    const [row] = await recordsOf(call.model);
    expect(row).toMatchObject({ status: 'unknown', errorCode: 'timeout', inputTokens: null });
    expect(row.finishedAt).toBeInstanceOf(Date);
  });

  it('estimates the cost of a call to a priced model with the price table’s version', async () => {
    const call = pricedLookupCall();

    await trackUsage(
      db,
      call,
      async () => ({
        result: null,
        outcome: { status: 'succeeded', inputTokens: 812, outputTokens: 96 },
      }),
      () => ({ status: 'failed' }),
    );

    expect(await recordsFor(call.resourceId ?? '')).toEqual([
      expect.objectContaining({
        inputTokens: 812,
        outputTokens: 96,
        estimatedCost: '0.000129',
        priceVersion: priceConfig.version,
      }),
    ]);
  });

  it('leaves the cost of a call whose usage is unknown empty', async () => {
    const call = pricedLookupCall();

    await expect(
      trackUsage(
        db,
        call,
        async () => {
          throw new Error('timed out');
        },
        () => ({ status: 'unknown', errorCode: 'timeout' }),
      ),
    ).rejects.toThrow('timed out');

    expect(await recordsFor(call.resourceId ?? '')).toEqual([
      expect.objectContaining({ status: 'unknown', estimatedCost: null, priceVersion: null }),
    ]);
  });
});

describe('pricedOutcome', () => {
  it('prices speech by its CPU time', () => {
    expect(pricedOutcome(speechConfig, { status: 'succeeded', cpuMs: 1600, audioMs: 700 })).toEqual(
      {
        status: 'succeeded',
        cpuMs: 1600,
        audioMs: 700,
        estimatedCost: '0.000000',
        priceVersion: priceConfig.version,
      },
    );
  });

  it('keeps an estimate the outcome already has', () => {
    const outcome = { status: 'succeeded' as const, estimatedCost: '1.000000', priceVersion: 'x' };
    expect(pricedOutcome(aiConfig, outcome)).toBe(outcome);
  });
});
