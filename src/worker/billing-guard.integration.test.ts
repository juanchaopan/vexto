import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudBilling } from '../features/billing-guard/index.ts';
import { listen } from '../lib/http-server.ts';
import { BUDGET_NOTIFICATION_PATH, createBillingGuardServer } from './billing-guard.ts';

// The Cloud Billing API is replaced by a test double; the rest runs as on Cloud Run.
const billing = {
  projectId: vi.fn(async () => 'vexto-staging'),
  isBillingEnabled: vi.fn(async () => true),
  disableBilling: vi.fn(async () => undefined),
} satisfies CloudBilling;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createBillingGuardServer(billing);
  baseUrl = `http://127.0.0.1:${await listen(server, 0)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

function postNotification(costAmount: number, budgetAmount: number) {
  const notification = {
    budgetDisplayName: 'vexto-staging',
    costAmount,
    costIntervalStart: '2026-11-01T07:00:00Z',
    budgetAmount,
    budgetAmountType: 'SPECIFIED_AMOUNT',
    currencyCode: 'USD',
  };
  const push = {
    message: {
      data: Buffer.from(JSON.stringify(notification)).toString('base64'),
      messageId: '42',
      publishTime: '2026-11-22T10:00:00.000Z',
    },
    subscription: 'projects/vexto-staging/subscriptions/vexto-budget',
  };
  return fetch(`${baseUrl}${BUDGET_NOTIFICATION_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(push),
  });
}

describe('vexto-billing-guard', () => {
  it('answers the health check', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('disables billing when a pushed notification is over the budget', async () => {
    const response = await postNotification(0.07, 0.01);

    expect(response.status).toBe(204);
    expect(billing.disableBilling).toHaveBeenCalledWith('vexto-staging');
  });

  it('keeps billing when a pushed notification is within the budget', async () => {
    const response = await postNotification(0, 0.01);

    expect(response.status).toBe(204);
    expect(billing.disableBilling).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON', async () => {
    const response = await fetch(`${baseUrl}${BUDGET_NOTIFICATION_PATH}`, {
      method: 'POST',
      body: 'not json',
    });

    expect(response.status).toBe(422);
    expect(billing.projectId).not.toHaveBeenCalled();
  });
});
