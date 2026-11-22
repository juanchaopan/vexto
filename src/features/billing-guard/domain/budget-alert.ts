/** What a Cloud Billing budget notification reports about the budget's current period. */
export type BudgetAlert = {
  budgetDisplayName: string;
  costAmount: number;
  budgetAmount: number;
  currencyCode: string;
};

/**
 * Whether the guard disables the project's billing: the cost so far is above zero and above the
 * budget. The budget is meant to be the smallest amount Cloud Billing accepts, so any real cost
 * crosses it; a notification within the budget leaves billing on.
 */
export function isOverBudget({ costAmount, budgetAmount }: BudgetAlert): boolean {
  return costAmount > 0 && costAmount > budgetAmount;
}
