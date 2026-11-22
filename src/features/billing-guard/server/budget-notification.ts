// Reads the body Pub/Sub pushes for a Cloud Billing budget notification: an envelope whose
// message carries the notification as base64-encoded JSON. Fields the guard does not use are
// ignored, so additions to either format do not break it.
import { z } from 'zod';
import type { BudgetAlert } from '../domain/budget-alert.ts';

const pushEnvelope = z.object({
  message: z.object({
    data: z.string().min(1),
    messageId: z.string().optional(),
  }),
});

const budgetNotification = z.object({
  budgetDisplayName: z.string(),
  costAmount: z.number(),
  budgetAmount: z.number(),
  currencyCode: z.string(),
});

export type ParsedBudgetPush =
  { ok: true; alert: BudgetAlert; messageId?: string } | { ok: false; reason: string };

function decodeJson(base64: string): unknown {
  try {
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export function parseBudgetPush(body: unknown): ParsedBudgetPush {
  const envelope = pushEnvelope.safeParse(body);
  if (!envelope.success) {
    return { ok: false, reason: 'The body is not a Pub/Sub push message.' };
  }
  const { data, messageId } = envelope.data.message;
  const notification = budgetNotification.safeParse(decodeJson(data));
  if (!notification.success) {
    return { ok: false, reason: 'The message is not a budget notification.' };
  }
  return { ok: true, alert: notification.data, messageId };
}
