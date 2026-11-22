// Handles the budget notifications Pub/Sub pushes to the billing guard. A notification that
// reports any cost disables the project's billing, unless it is disabled already. Pub/Sub treats
// a 2xx answer as delivered; a failed Cloud Billing call answers 503, so Pub/Sub delivers the
// notification again until billing is disabled.
import { errorResponse, type RouteHandler } from '../../../lib/http-server.ts';
import { errorFields, log } from '../../../lib/log.ts';
import { shouldDisableBilling, type BudgetAlert } from '../domain/budget-alert.ts';
import { parseBudgetPush } from './budget-notification.ts';
import type { CloudBilling } from './cloud-billing.ts';

function alertFields(alert: BudgetAlert, messageId: string | undefined) {
  return {
    messageId,
    budget: alert.budgetDisplayName,
    costAmount: alert.costAmount,
    budgetAmount: alert.budgetAmount,
    currencyCode: alert.currencyCode,
  };
}

async function disableBillingOnce(billing: CloudBilling, fields: Record<string, unknown>) {
  const projectId = await billing.projectId();
  if (!(await billing.isBillingEnabled(projectId))) {
    log('INFO', 'The cost is above zero and billing is already disabled.', {
      ...fields,
      projectId,
    });
    return;
  }
  await billing.disableBilling(projectId);
  log('WARNING', 'The cost is above zero; billing has been disabled.', {
    ...fields,
    projectId,
  });
}

export function createBudgetPushHandler(billing: CloudBilling): RouteHandler {
  return async ({ body }) => {
    const parsed = parseBudgetPush(body);
    if (!parsed.ok) {
      log('WARNING', 'Refused a push that is not a budget notification.', {
        reason: parsed.reason,
      });
      return errorResponse(400, 'INVALID_INPUT', parsed.reason, false);
    }
    const fields = alertFields(parsed.alert, parsed.messageId);
    if (!shouldDisableBilling(parsed.alert)) {
      log('INFO', 'Nothing has been spent; billing stays enabled.', fields);
      return { status: 204 };
    }
    try {
      await disableBillingOnce(billing, fields);
      return { status: 204 };
    } catch (error) {
      log('ERROR', 'Disabling billing failed; Pub/Sub will deliver the notification again.', {
        ...fields,
        ...errorFields(error),
      });
      return errorResponse(503, 'UNAVAILABLE', 'The Cloud Billing API call failed.', true);
    }
  };
}
