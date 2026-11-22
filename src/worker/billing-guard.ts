// Entry of the Cloud Run service vexto-billing-guard. The budget's Pub/Sub topic pushes every
// budget notification to BUDGET_NOTIFICATION_PATH, and a cost over the budget disables the
// project's billing (.docs/decisions/0019-cloud-cost-guard.md). Cloud Run checks the caller's
// identity before a request reaches it.
// Run with: node src/worker/billing-guard.ts   (listens on PORT, 8080 by default)
import {
  createBudgetPushHandler,
  createCloudBilling,
  type CloudBilling,
} from '../features/billing-guard/index.ts';
import { createJsonServer, health, serve } from '../lib/http-server.ts';

/** Path of the Pub/Sub push subscription's endpoint on this service. */
export const BUDGET_NOTIFICATION_PATH = '/budget-notifications';

export function createBillingGuardServer(billing: CloudBilling = createCloudBilling()) {
  return createJsonServer({
    'GET /health': health,
    [`POST ${BUDGET_NOTIFICATION_PATH}`]: createBudgetPushHandler(billing),
  });
}

if (import.meta.main) {
  await serve(createBillingGuardServer(), 'vexto-billing-guard');
}
