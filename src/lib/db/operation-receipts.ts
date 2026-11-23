// Operation receipts (.docs/design/rules.md, 并发和多设备): a write that carries an operationId
// records its kind, a digest of the request and its response in the same transaction as the
// write. The same operationId with the same kind and request gets the first response again and
// writes nothing; with a different kind or request it gets 409 OPERATION_MISMATCH. Receipts count
// for 24 hours; the collection job deletes older ones.
//
// A handler calls findOperationResult() before its external calls, so a repeated request does
// not call the AI again, and then does its writes inside runOperation(), which holds the member's
// row first: a member revoked meanwhile gets NOT_A_MEMBER with nothing written, and requests that
// arrive at the same time take turns, the later one reading the earlier one's receipt.
import { and, eq, sql } from 'drizzle-orm';
import { ApiError, errorBody } from '../api/errors.ts';
import type { ApiResult } from '../api/responses.ts';
import { requestDigest } from '../digest.ts';
import { lockActiveMember } from './active-member.ts';
import type { Executor, Transaction } from './client.ts';
import { operationReceipts, type OperationKind } from './schema.ts';

/** How long a receipt answers for its operationId, as a PostgreSQL interval. */
const retention = sql.raw(`interval '24 hours'`);

export type Operation = {
  ownerId: string;
  operationId: string;
  kind: OperationKind;
  /** What makes two requests the same: the route's IDs and the body without the operationId. */
  request: unknown;
};

type Receipt = typeof operationReceipts.$inferSelect;

function receiptOf(operation: Operation) {
  return and(
    eq(operationReceipts.ownerId, operation.ownerId),
    eq(operationReceipts.operationId, operation.operationId),
  );
}

const isCurrent = sql`${operationReceipts.createdAt} > now() - ${retention}`;
const isExpired = sql`${operationReceipts.createdAt} <= now() - ${retention}`;

async function currentReceipt(executor: Executor, operation: Operation) {
  const [receipt] = await executor
    .select()
    .from(operationReceipts)
    .where(and(receiptOf(operation), isCurrent));
  return receipt;
}

function replay(receipt: Receipt, operation: Operation, digest: string): ApiResult {
  if (receipt.kind !== operation.kind || receipt.requestDigest !== digest) {
    throw new ApiError(
      'OPERATION_MISMATCH',
      'This operationId was already used for a different request.',
    );
  }
  return { status: receipt.responseStatus, body: receipt.responseBody ?? undefined };
}

/**
 * The first response of this operation when it has a receipt, null when it has none yet; throws
 * OPERATION_MISMATCH when the operationId was used for a different request.
 */
export async function findOperationResult(
  executor: Executor,
  operation: Operation,
): Promise<ApiResult | null> {
  const receipt = await currentReceipt(executor, operation);
  return receipt ? replay(receipt, operation, requestDigest(operation.request)) : null;
}

async function runAndAnswer(
  tx: Transaction,
  requestId: string,
  work: (tx: Transaction) => Promise<ApiResult>,
): Promise<ApiResult> {
  try {
    // A savepoint, so a refused request leaves no partial write behind its stored answer.
    return await tx.transaction(work);
  } catch (error) {
    if (error instanceof ApiError && !error.retryable) {
      return { status: error.status, body: errorBody(error, requestId) };
    }
    throw error;
  }
}

/**
 * Runs the writes of an operation once, inside the caller's transaction, and stores the result
 * as its receipt. The member's row is held first, so a second request with this operationId waits
 * for this transaction to end, and a member who is no longer active gets NOT_A_MEMBER with no
 * receipt. A repeated request gets the stored result without running `work`. When `work` throws
 * an ApiError that resending cannot fix (such as NOT_FOUND), its writes are rolled back and that
 * error is the stored answer; any other error rolls back the whole transaction and stores
 * nothing, so the client can resend with the same operationId.
 */
export async function runOperation(
  tx: Transaction,
  operation: Operation & { requestId: string },
  work: (tx: Transaction) => Promise<ApiResult>,
): Promise<ApiResult> {
  await lockActiveMember(tx, operation.ownerId);
  const digest = requestDigest(operation.request);
  await tx.delete(operationReceipts).where(and(receiptOf(operation), isExpired));
  const receipt = await currentReceipt(tx, operation);
  if (receipt) {
    return replay(receipt, operation, digest);
  }
  const result = await runAndAnswer(tx, operation.requestId, work);
  await tx.insert(operationReceipts).values({
    ownerId: operation.ownerId,
    operationId: operation.operationId,
    kind: operation.kind,
    requestDigest: digest,
    responseStatus: result.status,
    responseBody: result.body ?? null,
  });
  return result;
}

/** Deletes the receipts older than 24 hours and returns how many there were. */
export async function deleteExpiredOperationReceipts(executor: Executor): Promise<number> {
  const deleted = await executor
    .delete(operationReceipts)
    .where(isExpired)
    .returning({ operationId: operationReceipts.operationId });
  return deleted.length;
}
