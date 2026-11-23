'use client';

// The sign-in page (.docs/design/screens.md, 登录): Clerk's sign-in component, which offers the
// only sign-in method the Clerk application has, Continue with Google. A Google account new to
// Clerk is signed up in the same flow, since anyone may complete the Google sign-in and the
// member list decides who can use the application. Its look is set in clerk-appearance.ts.
import { SignIn } from '@clerk/nextjs';
import { ARTICLES_PATH } from './top-bar.tsx';

export function SignInScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-4 py-6">
      <SignIn
        routing="path"
        path="/sign-in"
        withSignUp
        fallbackRedirectUrl={ARTICLES_PATH}
        signUpFallbackRedirectUrl={ARTICLES_PATH}
      />
    </main>
  );
}
