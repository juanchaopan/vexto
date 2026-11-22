import { describe, expect, it } from 'vitest';
import { shouldDisableBilling, type BudgetAlert } from './budget-alert.ts';

function alert(costAmount: number, budgetAmount: number): BudgetAlert {
  return { budgetDisplayName: 'vexto-staging', costAmount, budgetAmount, currencyCode: 'USD' };
}

describe('shouldDisableBilling', () => {
  it('is true as soon as the cost is above zero', () => {
    expect(shouldDisableBilling(alert(0.01, 0.01))).toBe(true);
    expect(shouldDisableBilling(alert(0.02, 0.01))).toBe(true);
  });

  it('is true for any cost above zero, whatever the budget', () => {
    expect(shouldDisableBilling(alert(0.5, 1))).toBe(true);
    expect(shouldDisableBilling(alert(0.001, 100))).toBe(true);
    expect(shouldDisableBilling(alert(5, 0))).toBe(true);
  });

  it('is false when nothing has been spent, whatever the budget', () => {
    expect(shouldDisableBilling(alert(0, 0.01))).toBe(false);
    expect(shouldDisableBilling(alert(0, 0))).toBe(false);
    expect(shouldDisableBilling(alert(0, -1))).toBe(false);
  });
});
