import { Suspense } from 'react';
import { SignInScreen } from '../../../features/account/index.ts';

// Clerk's sign-in component routes its own steps below /sign-in, hence the catch-all segment. It
// reads the current path, which this dynamic route knows only at request time, so it renders
// behind a Suspense boundary.
export default function SignInPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-surface" />}>
      <SignInScreen />
    </Suspense>
  );
}
