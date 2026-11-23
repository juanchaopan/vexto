// Authenticates every request with Clerk before it reaches a page or Route Handler
// (.docs/design/rules.md, 成员和登录). The sign-in page and the license page are public; the
// health check is left out of the matcher altogether, so it answers even without Clerk. Without a
// session, a page request goes to the sign-in page, which returns to the page after signing in,
// and an API request is answered with the interface's 401 UNAUTHENTICATED body. Being an active
// member and having accepted the terms are checked by each Route Handler
// (src/features/account/server/member-request.ts), since that needs the database.
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { ApiError } from './lib/api/errors.ts';
import { errorResponse } from './lib/api/responses.ts';
import { newRequestId } from './lib/api/route.ts';

const isPublicPage = createRouteMatcher(['/sign-in(.*)', '/license']);

export default clerkMiddleware(
  async (auth, request) => {
    if (isPublicPage(request)) {
      return;
    }
    const session = await auth();
    if (session.userId) {
      return;
    }
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return errorResponse(new ApiError('UNAUTHENTICATED', 'Sign in first.'), newRequestId());
    }
    // Clerk builds the address to return to from the request's own host headers, which name the
    // site as the browser sees it.
    return session.redirectToSignIn();
  },
  { signInUrl: '/sign-in', signUpUrl: '/sign-in' },
);

export const config = {
  // Everything but Next.js internals, files with an extension (static files) and the health check.
  matcher: ['/((?!_next/|api/health(?:/|$)|.*\\.[^/]+$).*)'],
};
