import { describe, expect, it } from 'vitest';
import {
  billingInfoUrl,
  createCloudBilling,
  type AuthorizedClient,
  type BillingRequest,
} from './cloud-billing.ts';

/** Credentials whose client records each request and answers with the next response. */
function fakeAuth(responses: unknown[]) {
  const requests: BillingRequest[] = [];
  const client: AuthorizedClient = {
    async request<T>(options: BillingRequest) {
      requests.push(options);
      return { data: responses.shift() as T };
    },
  };
  const auth = {
    getClient: async () => client,
    getProjectId: async () => 'vexto-staging',
  };
  return { auth, requests };
}

const url = billingInfoUrl('vexto-staging');

describe('billingInfoUrl', () => {
  it('names the billing info of the project', () => {
    expect(url).toBe('https://cloudbilling.googleapis.com/v1/projects/vexto-staging/billingInfo');
  });
});

describe('createCloudBilling', () => {
  it('reads the project from the credentials', async () => {
    const { auth } = fakeAuth([]);

    expect(await createCloudBilling(auth).projectId()).toBe('vexto-staging');
  });

  it('reports whether billing is enabled, which the API leaves out when it is not', async () => {
    const { auth, requests } = fakeAuth([{ billingEnabled: true }, {}]);
    const billing = createCloudBilling(auth);

    expect(await billing.isBillingEnabled('vexto-staging')).toBe(true);
    expect(await billing.isBillingEnabled('vexto-staging')).toBe(false);
    expect(requests).toEqual([
      { url, method: 'GET' },
      { url, method: 'GET' },
    ]);
  });

  it('disables billing by clearing the billing account of the project', async () => {
    const { auth, requests } = fakeAuth([{ billingEnabled: false }]);

    await createCloudBilling(auth).disableBilling('vexto-staging');

    expect(requests).toEqual([{ url, method: 'PUT', data: { billingAccountName: '' } }]);
  });

  it('passes a failed call on to the caller', async () => {
    const auth = {
      getClient: async (): Promise<AuthorizedClient> => ({
        request: async () => {
          throw new Error('403 PERMISSION_DENIED');
        },
      }),
      getProjectId: async () => 'vexto-staging',
    };

    await expect(createCloudBilling(auth).disableBilling('vexto-staging')).rejects.toThrow(
      'PERMISSION_DENIED',
    );
  });
});
