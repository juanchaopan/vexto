import { describe, expect, it } from 'vitest';
import { isOverBudget, type BudgetAlert } from './budget-alert.ts';

function alert(costAmount: number, budgetAmount: number): BudgetAlert {
  return { budgetDisplayName: 'vexto-staging', costAmount, budgetAmount, currencyCode: 'USD' };
}

describe('isOverBudget', () => {
  it('is true when the cost is above zero and above the budget', () => {
    expect(isOverBudget(alert(0.02, 0.01))).toBe(true);
    expect(isOverBudget(alert(5, 1))).toBe(true);
  });

  it('is false while the cost is within the budget', () => {
    expect(isOverBudget(alert(0.01, 0.01))).toBe(false);
    expect(isOverBudget(alert(0.5, 1))).toBe(false);
  });

  it('is false when nothing has been spent, whatever the budget', () => {
    expect(isOverBudget(alert(0, 0))).toBe(false);
    expect(isOverBudget(alert(0, -1))).toBe(false);
  });
});
