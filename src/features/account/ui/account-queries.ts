'use client';

// The browser side of the account endpoints: the signed-in member's profile, accepting the terms,
// and logging out.
import { useClerk } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import { apiRequest, dataBody } from '../../../lib/api/client.ts';
import { runSignOutCleanups } from '../../../lib/ui/sign-out-cleanup.ts';
import { hasAcceptedTerms } from '../domain/terms.ts';

export const SIGN_IN_PATH = '/sign-in';

export const meQueryKey = ['me'] as const;

const profileSchema = z.object({
  email: z.string(),
  terms: z.object({
    currentVersion: z.number().int(),
    acceptedVersion: z.number().int().nullable(),
    acceptedAt: z.iso.datetime().nullable(),
  }),
});

export type Profile = z.infer<typeof profileSchema>;

const acceptanceSchema = z.object({
  acceptedVersion: z.number().int(),
  acceptedAt: z.iso.datetime(),
});

/** True once the profile shows the current terms version accepted. */
export function acceptedCurrentTerms({ terms }: Profile): boolean {
  return hasAcceptedTerms(
    {
      termsVersion: terms.acceptedVersion,
      termsAcceptedAt: terms.acceptedAt === null ? null : new Date(terms.acceptedAt),
    },
    terms.currentVersion,
  );
}

/** `GET /api/me`, read again whenever the window regains focus. */
export function useProfile() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async ({ signal }) =>
      (await apiRequest('/api/me', dataBody(profileSchema), { signal })).data,
  });
}

/** `POST /api/terms/acceptance`; on success the cached profile shows the acceptance. */
export function useAcceptTerms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (version: number) =>
      (
        await apiRequest('/api/terms/acceptance', dataBody(acceptanceSchema), {
          method: 'POST',
          body: { version },
        })
      ).data,
    onSuccess: (acceptance) => {
      queryClient.setQueryData<Profile>(meQueryKey, (profile) =>
        profile ? { ...profile, terms: { ...profile.terms, ...acceptance } } : profile,
      );
    },
  });
}

/**
 * Logging out (.docs/design/rules.md, 成员和登录): the registered cleanups stop playback and
 * clear what they keep, Clerk signs out and the sign-in page opens, and then no cached server
 * data is left in the browser.
 */
export function useLogOut() {
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);
  const logOut = useCallback(async () => {
    setLoggingOut(true);
    runSignOutCleanups();
    try {
      await signOut({ redirectUrl: SIGN_IN_PATH });
    } finally {
      queryClient.clear();
      setLoggingOut(false);
    }
  }, [signOut, queryClient]);
  return { logOut, loggingOut };
}
