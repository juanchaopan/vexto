import { describe, expect, it } from 'vitest';
import { parseBudgetPush } from './budget-notification.ts';

const notification = {
  budgetDisplayName: 'vexto-staging',
  alertThresholdExceeded: 1.0,
  costAmount: 0.03,
  costIntervalStart: '2026-11-01T07:00:00Z',
  budgetAmount: 0.01,
  budgetAmountType: 'SPECIFIED_AMOUNT',
  currencyCode: 'USD',
};

function push(data: string) {
  return {
    message: {
      data,
      attributes: { billingAccountId: '01D4EE-079462-DFD6EC', schemaVersion: '1.0' },
      messageId: '136969346945',
      publishTime: '2026-11-22T10:00:00.000Z',
    },
    subscription: 'projects/vexto-staging/subscriptions/budget-alerts',
  };
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

describe('parseBudgetPush', () => {
  it('reads the budget notification inside a Pub/Sub push message', () => {
    expect(parseBudgetPush(push(encode(notification)))).toEqual({
      ok: true,
      messageId: '136969346945',
      alert: {
        budgetDisplayName: 'vexto-staging',
        costAmount: 0.03,
        budgetAmount: 0.01,
        currencyCode: 'USD',
      },
    });
  });

  it('refuses a body that is not a push message', () => {
    for (const body of [undefined, null, 'text', {}, { message: {} }, { message: { data: '' } }]) {
      expect(parseBudgetPush(body)).toEqual({
        ok: false,
        reason: 'The body is not a Pub/Sub push message.',
      });
    }
  });

  it('refuses a message that does not carry a budget notification', () => {
    const notBudget = [
      Buffer.from('not json').toString('base64'),
      encode({ hello: 'world' }),
      encode({ ...notification, costAmount: '0.03' }),
      encode({ ...notification, budgetAmount: undefined }),
    ];
    for (const data of notBudget) {
      expect(parseBudgetPush(push(data))).toEqual({
        ok: false,
        reason: 'The message is not a budget notification.',
      });
    }
  });
});
