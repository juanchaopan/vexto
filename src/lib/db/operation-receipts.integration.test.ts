import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { members } from '../../features/account/index.ts';
import { seenItems } from '../../features/collection/server/schema.ts';
import { ApiError } from '../api/errors.ts';
import { dataResult, noContentResult } from '../api/responses.ts';
import { closeDatabase, getDatabase, inTransaction, type Transaction } from './client.ts';
import {
  deleteExpiredOperationReceipts,
  findOperationResult,
  runOperation,
  type Operation,
} from './operation-receipts.ts';
import { operationReceipts } from './schema.ts';

// The tests run against the throwaway database the integration setup migrated. Every test uses a
// member of its own, so the files running side by side do not meet each other's receipts. The
// operations write rows to seen_items, a table without an owner, to show what was written.

const db = getDatabase();

afterAll(async () => {
  await closeDatabase();
});

let ownerId: string;

beforeEach(async () => {
  const [member] = await db
    .insert(members)
    .values({ email: `receipts-${randomUUID()}@example.com`, status: 'active' })
    .returning({ id: members.id });
  ownerId = member.id;
});

function operation(request: unknown = { cardId: 'c1', answer: 'resilient' }) {
  return {
    ownerId,
    operationId: randomUUID(),
    kind: 'review.submit',
    request,
    requestId: 'req_test',
  } satisfies Operation & { requestId: string };
}

/** An operation that writes one marker row and answers with it. */
function writeMarker(marker: string) {
  return async (tx: Transaction) => {
    await tx.insert(seenItems).values({ urlHash: marker });
    return dataResult({ marker }, 201);
  };
}

async function markerExists(marker: string) {
  const rows = await db.select().from(seenItems).where(eq(seenItems.urlHash, marker));
  return rows.length === 1;
}

describe('runOperation', () => {
  it('stores the first result and answers a repeat with it, without writing again', async () => {
    const op = operation();
    const marker = randomUUID();

    const first = await inTransaction((tx) => runOperation(tx, op, writeMarker(marker)));
    const again = vi.fn(writeMarker(randomUUID()));
    const repeated = await inTransaction((tx) => runOperation(tx, op, again));

    expect(first).toEqual({ status: 201, body: { data: { marker } } });
    expect(repeated).toEqual(first);
    expect(again).not.toHaveBeenCalled();
    expect(await markerExists(marker)).toBe(true);
    expect(await findOperationResult(db, op)).toEqual(first);
  });

  it('matches a repeat by content, whatever order its fields come in', async () => {
    const op = operation({ cardId: 'c1', answer: { text: 'resilient' } });
    await inTransaction((tx) => runOperation(tx, op, writeMarker(randomUUID())));

    const reordered = { ...op, request: { answer: { text: 'resilient' }, cardId: 'c1' } };
    expect(await findOperationResult(db, reordered)).not.toBeNull();
  });

  it('refuses the same operationId with another request or another kind', async () => {
    const op = operation();
    await inTransaction((tx) => runOperation(tx, op, writeMarker(randomUUID())));
    const mismatch = expect.objectContaining({ code: 'OPERATION_MISMATCH', status: 409 });

    const changed = { ...op, request: { cardId: 'c1', answer: 'resilience' } };
    await expect(findOperationResult(db, changed)).rejects.toEqual(mismatch);
    await expect(
      inTransaction((tx) => runOperation(tx, changed, writeMarker(randomUUID()))),
    ).rejects.toEqual(mismatch);
    await expect(findOperationResult(db, { ...op, kind: 'vocabulary.delete' })).rejects.toEqual(
      mismatch,
    );
  });

  it('keeps receipts apart per member', async () => {
    const op = operation();
    await inTransaction((tx) => runOperation(tx, op, writeMarker(randomUUID())));
    const [other] = await db
      .insert(members)
      .values({ email: `receipts-${randomUUID()}@example.com`, status: 'active' })
      .returning({ id: members.id });

    expect(await findOperationResult(db, { ...op, ownerId: other.id })).toBeNull();
  });

  it('stores a 204 without a body', async () => {
    const op = operation();
    await inTransaction((tx) => runOperation(tx, op, async () => noContentResult()));

    const [receipt] = await db
      .select()
      .from(operationReceipts)
      .where(eq(operationReceipts.operationId, op.operationId));
    expect(receipt).toMatchObject({ responseStatus: 204, responseBody: null });
    expect(await findOperationResult(db, op)).toEqual({ status: 204, body: undefined });
  });

  it('stores a refusal as the answer and rolls back the writes made before it', async () => {
    const op = operation();
    const marker = randomUUID();

    const result = await inTransaction((tx) =>
      runOperation(tx, op, async (inner) => {
        await writeMarker(marker)(inner);
        throw new ApiError('CONFLICT', 'The card changed.');
      }),
    );

    const refusal = {
      status: 409,
      body: {
        error: {
          code: 'CONFLICT',
          message: 'The card changed.',
          retryable: false,
          requestId: 'req_test',
        },
      },
    };
    expect(result).toEqual(refusal);
    expect(await markerExists(marker)).toBe(false);
    expect(await findOperationResult(db, op)).toEqual(refusal);
  });

  it('stores nothing when the operation fails in a way resending can fix', async () => {
    for (const failure of [new ApiError('UNAVAILABLE', 'Try again.'), new Error('lost')]) {
      const op = operation();
      const marker = randomUUID();

      await expect(
        inTransaction((tx) =>
          runOperation(tx, op, async (inner) => {
            await writeMarker(marker)(inner);
            throw failure;
          }),
        ),
      ).rejects.toBe(failure);

      expect(await markerExists(marker)).toBe(false);
      expect(await findOperationResult(db, op)).toBeNull();
    }
  });

  it('makes a second request with the same operationId wait for the first and reuse its result', async () => {
    const op = operation();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = vi.fn(async (tx: Transaction) => {
      await held;
      return writeMarker(randomUUID())(tx);
    });

    const first = inTransaction((tx) => runOperation(tx, op, work));
    await vi.waitFor(() => expect(work).toHaveBeenCalledOnce());
    const second = inTransaction((tx) => runOperation(tx, op, work));
    release();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(secondResult).toEqual(firstResult);
    expect(work).toHaveBeenCalledOnce();
  });

  it('treats a receipt older than 24 hours as gone', async () => {
    const op = operation();
    await inTransaction((tx) => runOperation(tx, op, writeMarker(randomUUID())));
    await db
      .update(operationReceipts)
      .set({ createdAt: sql`now() - interval '24 hours 1 second'` })
      .where(eq(operationReceipts.operationId, op.operationId));

    expect(await findOperationResult(db, op)).toBeNull();
    const marker = randomUUID();
    const rerun = await inTransaction((tx) => runOperation(tx, op, writeMarker(marker)));
    expect(rerun).toEqual({ status: 201, body: { data: { marker } } });
  });
});

describe('deleteExpiredOperationReceipts', () => {
  it('deletes the receipts older than 24 hours and keeps the others', async () => {
    const old = operation();
    const recent = operation();
    for (const op of [old, recent]) {
      await inTransaction((tx) => runOperation(tx, op, async () => noContentResult()));
    }
    await db
      .update(operationReceipts)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(operationReceipts.operationId, old.operationId));

    expect(await deleteExpiredOperationReceipts(db)).toBeGreaterThanOrEqual(1);
    const left = await db
      .select({ operationId: operationReceipts.operationId })
      .from(operationReceipts)
      .where(eq(operationReceipts.ownerId, ownerId));
    expect(left).toEqual([{ operationId: recent.operationId }]);
  });
});
