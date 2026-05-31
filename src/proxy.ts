import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`. The shape
 * is identical — same matcher syntax, same `NextRequest`/`NextResponse`
 * surface — only the filename and exported function name changed.
 *
 * Two responsibilities:
 *
 * 1. **Refresh the Supabase access token on every request.** Tokens expire
 *    after one hour. Without a fresh cookie, `auth.getUser()` inside route
 *    handlers returns null, ownership-gated mutation routes return 401
 *    "Not authenticated", and the user sees toasts like "Re-analyze failed"
 *    even though they're logged in. We MUST run on `/api/*` for this to
 *    actually help mutation endpoints — earlier versions of this matcher
 *    excluded `api`, which caused exactly that bug.
 *
 * 2. **Optionally redirect unauthenticated traffic away from dashboard
 *    routes.** Off by default (the app supports unauthenticated browsing
 *    of `/share/*` and a few other surfaces). Flip `AUTH_REDIRECTS_ENABLED`
 *    to enable.
 */
// ── Content-Security-Policy ──────────────────────────────────────────────
// Strict, nonce-based CSP. Shipping in REPORT-ONLY first: an *enforcing*
// strict script-src white-screens any statically-rendered page (Next's
// build-time inline bootstrap scripts can't receive a per-request nonce).
// Report-Only lets the policy bake against real traffic with zero risk;
// flip CSP_ENFORCE to true once the violation reports are clean.
const CSP_ENFORCE = false;

function buildCsp(nonce: string, framable = false): string {
  // /embed/* must be framable on any origin (it's a distribution widget), so
  // its frame-ancestors is wide-open; every other route stays locked to self.
  const frameAncestors = framable ? `frame-ancestors *` : `frame-ancestors 'self'`;
  return [
    `default-src 'self'`,
    // Next inline bootstrap gets the nonce; bundled chunks are 'self';
    // Stripe.js is allowlisted for embedded checkout. 'wasm-unsafe-eval'
    // permits WebAssembly compilation only (Essentia/audio-decode) — it does
    // NOT allow arbitrary JS eval, so it's safe. (Dev-mode HMR also trips
    // 'unsafe-eval'; that's a dev-only false positive — don't add it.)
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' https://js.stripe.com`,
    // Inline styles + styled-jsx need 'unsafe-inline' (style injection is not
    // a meaningful XSS vector the way script injection is).
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https: wss:`,
    `frame-src https://js.stripe.com https://*.stripe.com`,
    frameAncestors,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join('; ');
}

export async function proxy(request: NextRequest) {
  // Per-request nonce. Set the (enforcing) CSP on the REQUEST headers so the
  // App Router extracts the nonce and stamps it onto its <script> tags; the
  // browser sees whichever response header we choose below.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const framable = request.nextUrl.pathname.startsWith('/embed/');
  const csp = buildCsp(nonce, framable);
  const cspHeaderName = CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';

  const baseRequestHeaders = new Headers(request.headers);
  baseRequestHeaders.set('x-nonce', nonce);
  baseRequestHeaders.set('Content-Security-Policy', csp);

  const newResponse = () => {
    const r = NextResponse.next({ request: { headers: baseRequestHeaders } });
    r.headers.set(cspHeaderName, csp);
    return r;
  };

  let response = newResponse();

  // /embed/* is a public, cookieless distribution widget — skip the Supabase
  // token refresh entirely so it loads fast and never touches auth.
  if (framable) return response;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Local-store / offline dev: nothing to refresh, let everything through.
  if (!supabaseUrl || !supabaseAnon) return response;

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Mirror the refreshed cookies onto BOTH the inbound request (so the
        // downstream route handler sees them in the same cycle) and the
        // outgoing response.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = newResponse();
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() — not getSession() — actually validates the JWT against the
  // auth server and triggers a refresh when needed.
  const { data: { user } } = await supabase.auth.getUser();

  // Auth redirects are ON. Without this, unauthenticated users get to wander
  // through `/library`, `/projects`, etc. (because RLS reads are loose for
  // tracks/playlists) and only discover they're not signed in when a
  // mutation returns 401 — which surfaces as confusing toasts like
  // "Couldn't save rating: Not authenticated" while the UI looks fine.
  // Bouncing protected pages to `/login` makes the auth state obvious.
  //
  // Public surfaces (`/share/*`, the login page itself, the offline page)
  // are excluded by the matcher below or fall through this check.
  const protectedPaths = [
    '/library', '/projects', '/playlists', '/contacts',
    '/calendar', '/links', '/settings', '/studio', '/profile',
    '/campaigns',
  ];
  const path = request.nextUrl.pathname;
  // /projects/share/[token] is a PUBLIC reader page (same shape as
  // /share/[token]) — guests with a link must be able to view without an
  // account, so we explicitly exempt it from the redirect.
  const isPublicShare =
    path.startsWith('/share/') ||
    path.startsWith('/projects/share/');
  const isProtectedPath =
    !isPublicShare && protectedPaths.some((p) => path.startsWith(p));

  if (isProtectedPath && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // Buyers who signed in via OTP must not land inside the producer dashboard.
  // Identify the producer by the presence of their creator_profiles row.
  // The anon client with a valid session cookie can read the user's own row
  // via RLS — if it returns null the logged-in user is a buyer, not the producer.
  if (user && (isProtectedPath || path === '/login')) {
    const { data: profile } = await supabase
      .from('creator_profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!profile) {
      const url = request.nextUrl.clone();
      url.pathname = '/store/account/me';
      return NextResponse.redirect(url);
    }
  }

  if (path === '/login' && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/library';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on /api too — without it, route handlers see expired cookies.
  // Skip Next internals, static assets, and the public /share/* listener
  // pages (which don't need auth and shouldn't pay the refresh cost).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|share|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)',
  ],
};
