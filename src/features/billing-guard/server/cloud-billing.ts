// The Cloud Billing API calls of the billing guard. On Cloud Run, google-auth-library's default
// credentials are the service's own service account, read from the metadata server, and so is
// the project: the guard only ever disables the billing of the project it runs in.
import { GoogleAuth } from 'google-auth-library';

const API_ROOT = 'https://cloudbilling.googleapis.com/v1';
const CLOUD_BILLING_SCOPE = 'https://www.googleapis.com/auth/cloud-billing';

export type BillingRequest = { url: string; method: 'GET' | 'PUT'; data?: unknown };

/** The part of a google-auth-library client the guard uses: authorized HTTP requests. */
export type AuthorizedClient = {
  request<T>(options: BillingRequest): Promise<{ data: T }>;
};

export type BillingAuth = {
  getClient(): Promise<AuthorizedClient>;
  getProjectId(): Promise<string>;
};

export type CloudBilling = {
  projectId(): Promise<string>;
  isBillingEnabled(projectId: string): Promise<boolean>;
  /** Unlinks the project from its billing account, which stops every paid service in it. */
  disableBilling(projectId: string): Promise<void>;
};

type ProjectBillingInfo = { billingEnabled?: boolean };

export function billingInfoUrl(projectId: string) {
  return `${API_ROOT}/projects/${encodeURIComponent(projectId)}/billingInfo`;
}

export function createCloudBilling(
  auth: BillingAuth = new GoogleAuth({ scopes: [CLOUD_BILLING_SCOPE] }),
): CloudBilling {
  return {
    projectId: () => auth.getProjectId(),
    async isBillingEnabled(projectId) {
      const client = await auth.getClient();
      const { data } = await client.request<ProjectBillingInfo>({
        url: billingInfoUrl(projectId),
        method: 'GET',
      });
      return data.billingEnabled === true;
    },
    async disableBilling(projectId) {
      const client = await auth.getClient();
      await client.request<ProjectBillingInfo>({
        url: billingInfoUrl(projectId),
        method: 'PUT',
        data: { billingAccountName: '' },
      });
    },
  };
}
