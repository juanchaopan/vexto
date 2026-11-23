import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppProviders, clerkAppearance, clerkLocalization } from '../features/account/index.ts';
import './globals.css';

export const metadata: Metadata = {
  title: 'vexto',
};

// Every page knows the Clerk session: the public license page decides where its close button
// goes by it, and the pages behind the member gate need the signed-in account.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-in"
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
          afterSignOutUrl="/sign-in"
          appearance={clerkAppearance}
          localization={clerkLocalization}
        >
          <AppProviders>{children}</AppProviders>
        </ClerkProvider>
      </body>
    </html>
  );
}
