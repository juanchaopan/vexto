import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBudgetPushHandler } from './budget-push-handler.ts';
import type { CloudBilling } from './cloud-billing.ts';

function pushOf(costAmount: number, budgetAmount: number) {
  const notification = {
    budgetDisplayName: 'vexto-staging',
    costAmount,
    budgetAmount,
    currencyCode: 'USD',
  };
  return {
    message: { data: Buffer.from(JSON.stringify(notification)).toString('base64'), messageId: '1' },
  };
}

function fakeBilling(enabled = true) {
  return {
    projectId: vi.fn(async () => 'vexto-staging'),
    isBillingEnabled: vi.fn(async () => enabled),
    disableBilling: vi.fn(async () => undefined),
  } satisfies CloudBilling;
}

let logged: string[];

beforeEach(() => {
  logged = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    logged.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createBudgetPushHandler', () => {
  it('disables billing of the project when the cost is over the budget', async () => {
    const billing = fakeBilling();

    const response = await createBudgetPushHandler(billing)({ body: pushOf(0.02, 0.01) });

    expect(response).toEqual({ status: 204 });
    expect(billing.isBillingEnabled).toHaveBeenCalledWith('vexto-staging');
    expect(billing.disableBilling).toHaveBeenCalledWith('vexto-staging');
    expect(logged.join('')).toContain('billing has been disabled');
  });

  it('leaves billing alone while the cost is within the budget', async () => {
    const billing = fakeBilling();

    const response = await createBudgetPushHandler(billing)({ body: pushOf(0, 0.01) });

    expect(response).toEqual({ status: 204 });
    expect(billing.isBillingEnabled).not.toHaveBeenCalled();
    expect(billing.disableBilling).not.toHaveBeenCalled();
  });

  it('does not disable billing twice', async () => {
    const billing = fakeBilling(false);

    const response = await createBudgetPushHandler(billing)({ body: pushOf(3, 0.01) });

    expect(response).toEqual({ status: 204 });
    expect(billing.disableBilling).not.toHaveBeenCalled();
  });

  it('asks Pub/Sub to deliver again when the Cloud Billing call fails', async () => {
    const billing = fakeBilling();
    billing.disableBilling.mockRejectedValueOnce(new Error('503 Service Unavailable'));

    const response = await createBudgetPushHandler(billing)({ body: pushOf(3, 0.01) });

    expect(response).toEqual({
      status: 503,
      body: {
        error: {
          code: 'UNAVAILABLE',
          message: 'The Cloud Billing API call failed.',
          retryable: true,
        },
      },
    });
    expect(logged.join('')).toContain('"severity":"ERROR"');
  });

  it('refuses a body that is not a budget notification and calls nothing', async () => {
    const billing = fakeBilling();

    const response = await createBudgetPushHandler(billing)({ body: { hello: 'world' } });

    expect(response.status).toBe(400);
    expect(billing.projectId).not.toHaveBeenCalled();
  });
});
