// The Google identity token the web application sends to the speech service
// (.docs/decisions/0020-google-cloud-authentication.md). On Vercel the function's OIDC token is
// exchanged through the workload identity provider GCP_VERCEL_PROVIDER for a federated Google
// token, which impersonates the service account GCP_TTS_INVOKER_SERVICE_ACCOUNT to get an
// identity token whose audience is the service's address, TTS_SERVICE_URL. No long-lived key is
// stored anywhere. A development machine sets neither value and calls its local speech service
// without a token, as the architecture has it.
//
// The token is kept until shortly before it expires, so most requests need no exchange.
import { getVercelOidcToken } from '@vercel/oidc';
import { IdentityPoolClient, Impersonated } from 'google-auth-library';
import { isTokenFresh, tokenExpiry } from '../domain/identity-token.ts';

/** The token to send, or null when the speech service is called without one. */
export type IdTokenSource = () => Promise<string | null>;

export type FederationSettings = {
  /** Full resource name of the workload identity provider. */
  provider: string;
  serviceAccount: string;
  /** The speech service's address, the audience of the token. */
  audience: string;
};

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Exchanges the Vercel OIDC token for an identity token of the service account. */
export async function federatedIdToken(settings: FederationSettings): Promise<string> {
  const federated = new IdentityPoolClient({
    type: 'external_account',
    audience: `//iam.googleapis.com/${settings.provider}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() },
  });
  const impersonated = new Impersonated({
    sourceClient: federated,
    targetPrincipal: settings.serviceAccount,
    targetScopes: [CLOUD_PLATFORM_SCOPE],
    lifetime: 3600,
  });
  return impersonated.fetchIdToken(settings.audience, { includeEmail: true });
}

/** A source that keeps the token it fetched until it is about to expire. */
export function cachedIdTokens(
  fetchToken: () => Promise<string>,
  now: () => Date = () => new Date(),
): IdTokenSource {
  let cached: { token: string; expiresAt: Date | null } | undefined;
  let pending: Promise<string> | undefined;
  return async () => {
    if (cached && isTokenFresh(cached.expiresAt, now())) {
      return cached.token;
    }
    pending ??= fetchToken().finally(() => {
      pending = undefined;
    });
    const token = await pending;
    cached = { token, expiresAt: tokenExpiry(token) };
    return token;
  };
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The token source the runtime values call for: none on a development machine, which sets
 * neither GCP_VERCEL_PROVIDER nor GCP_TTS_INVOKER_SERVICE_ACCOUNT; the federated token when both
 * are set. Setting only one is a configuration error.
 */
export function idTokenSourceFromEnv(audience: string, env: Env = process.env): IdTokenSource {
  const provider = env.GCP_VERCEL_PROVIDER;
  const serviceAccount = env.GCP_TTS_INVOKER_SERVICE_ACCOUNT;
  if (!provider && !serviceAccount) {
    return async () => null;
  }
  if (!provider || !serviceAccount) {
    throw new Error(
      'GCP_VERCEL_PROVIDER and GCP_TTS_INVOKER_SERVICE_ACCOUNT must be set together.',
    );
  }
  return cachedIdTokens(() => federatedIdToken({ provider, serviceAccount, audience }));
}
