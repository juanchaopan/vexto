/** What a Cloud Billing budget notification reports about the budget's current period. */
export type BudgetAlert = {
  budgetDisplayName: string;
  costAmount: number;
  budgetAmount: number;
  currencyCode: string;
};

/**
 * Whether the guard disables the project's billing: as soon as the cost so far is above zero,
 * whatever the budget amount is. Normal use stays within the free tiers, so any cost means
 * something runs beyond them; a notification without cost leaves billing on.
 */
export function shouldDisableBilling({ costAmount }: BudgetAlert): boolean {
  return costAmount > 0;
}
