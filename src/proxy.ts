import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, cspHeaderName as cspHeaderNameFor } from '@/lib/security/csp';
import { apiGateFor, isLabelOsApiPath, isLabelOsJoinPagePath, isLabelOsPagePath, isLabelOsRestorePagePath, isLabelOsSetupPagePath, isPlatformApiPath, isPlatformPagePath } from '@/lib/security/api-gate';
import { isLabelOsEnabled } from '@/lib/labelos/flag';
import { hasAnyLabelOsMembership } from '@/lib/labelos/membership-gate';
import { memberLanding } from '@/lib/labelos/member-landing';
import { nonMemberLanding } from '@/lib/labelos/setup';
import { isSupabaseConfigured } from '@/lib/local-store';

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
// Content-Security-Policy: enforced on /store/*, report-only elsewhere.
// Why the split, and the policy itself, live in src/lib/security/csp.ts.

export async function proxy(request: NextRequest) {
  // Per-request nonce. Set the (enforcing) CSP on the REQUEST headers so the
  // App Router extracts the nonce and stamps it onto its <script> tags; the
  // browser sees whichever response header we choose below.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const framable = request.nextUrl.pathname.startsWith('/embed/');
  const csp = buildCsp(nonce, framable);
  const cspHeaderName = cspHeaderNameFor(request.nextUrl.pathname);

  const baseRequestHeaders = new Headers(request.headers);
  baseRequestHeaders.set('x-nonce', nonce);
  baseRequestHeaders.set('Content-Security-Policy', csp);

  const newResponse = () => {
    const r = NextResponse.next({ request: { headers: baseRequestHeaders } });
    r.headers.set(cspHeaderName, csp);
    return r;
  };

  let response = newResponse();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Label OS namespaces (`/api/org/*`, `/o/*`). Behind LABEL_OS_ENABLED: while
  // it is off they do not exist (404). Label OS has no local-store fallback —
  // a JSON-file copy of multi-tenant RLS would be a second, untested
  // authorisation implementation — so without Supabase it answers 503
  // (10-technical-architecture.md §12–13, risk R-24). No other path is
  // affected by either check.
  // `/join/<token>` (LABEL-08) is a Label OS page too, so it shares the flag
  // and the database check, but not the membership redirect below: an
  // invitee is not a member until the page has accepted for them.
  // The platform console (LABEL-47, `/platform`, `/api/platform/*`) is behind the same flag and needs the
  // same database, but takes no membership redirect: it answers 404 itself to anyone who is not an operator.
  const labelOsApi = isLabelOsApiPath(request.nextUrl.pathname) || isPlatformApiPath(request.nextUrl.pathname);
  const labelOsPage = isLabelOsPagePath(request.nextUrl.pathname);
  // `/restore/<org id>` (LABEL-39) likewise: the org it brings back is not live, so no live membership is required.
  // `/setup` (LABEL-48) too: a new account sets up its first org there, so it has no membership yet.
  const labelOsJoinPage =
    isLabelOsJoinPagePath(request.nextUrl.pathname) ||
    isLabelOsRestorePagePath(request.nextUrl.pathname) ||
    isLabelOsSetupPagePath(request.nextUrl.pathname) ||
    isPlatformPagePath(request.nextUrl.pathname);
  if (labelOsApi || labelOsPage || labelOsJoinPage) {
    if (!isLabelOsEnabled()) {
      return labelOsApi
        ? NextResponse.json({ error: 'Not found' }, { status: 404 })
        : new NextResponse('Not found', { status: 404 });
    }
    if (!supabaseUrl || !supabaseAnon || !isSupabaseConfigured()) {
      return labelOsApi
        ? NextResponse.json({ error: 'Label OS requires a database' }, { status: 503 })
        : new NextResponse('Label OS requires a database', { status: 503 });
    }
  }

  // /embed/* is a public, cookieless distribution widget — skip the Supabase
  // token refresh entirely so it loads fast and never touches auth.
  if (framable) return response;

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

  // The producer is the user with a creator_profiles row (RLS lets a session
  // read only its own). Buyers share this auth, so "signed in" is not enough.
  const isProducer = async (userId: string) => {
    const { data: profile } = await supabase
      .from('creator_profiles')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    return !!profile;
  };

  // API gate: a signed-in non-producer may reach only the public/buyer routes
  // in lib/security/api-gate.ts. Signed-out calls fall through to the route,
  // which answers 401 itself (or checks a cron bearer / webhook signature).
  // `/api/org/*` is the one namespace gated on org membership instead, and
  // membership admits to nothing else (risk R-03). `/api/org/join` alone is
  // gate `session`: a signed-in invitee is not a member yet, and the route
  // does every check itself (token, email, expiry, revoked, used).
  const apiGate = apiGateFor(request.nextUrl.pathname, !!user);
  if (user && apiGate === 'producer' && !(await isProducer(user.id))) {
    return NextResponse.json({ error: 'Producer account required' }, { status: 403 });
  }
  if (user && apiGate === 'member' && !(await hasAnyLabelOsMembership(supabase, user.id))) {
    return NextResponse.json({ error: 'Organization membership required' }, { status: 403 });
  }

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
    '/campaigns', '/store-editor', '/sales', '/analytics', '/offline',
    '/cover-art',
  ];
  const path = request.nextUrl.pathname;

  // Label OS pages need a session and some membership; which org the page
  // may show is the page's own check. A signed-in non-member goes to `/`,
  // which routes the producer to /library and a buyer on to their account.
  if (labelOsPage) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      url.searchParams.set('next', path + request.nextUrl.search);
      return NextResponse.redirect(url);
    }
    if (!(await hasAnyLabelOsMembership(supabase, user.id))) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return response;
  }

  // /projects/share/[token] is a PUBLIC reader page (same shape as
  // /share/[token]) — guests with a link must be able to view without an
  // account, so we explicitly exempt it from the redirect.
  const isPublicShare =
    path.startsWith('/share/') ||
    path.startsWith('/projects/share/');
  const isProtectedPath =
    !isPublicShare && protectedPaths.some((p) => path.startsWith(p));

  if (isProtectedPath && !user) {
    // `next` carries the query too. With the path alone, a deep link like
    // /studio?track=<id> left `track` behind as a stray param on /login and
    // the producer landed in an empty studio after signing in. The original
    // query is cleared from the login URL so it lives only inside `next`.
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Buyers who signed in via OTP must not land inside the producer dashboard.
  // Identify the producer by the presence of their creator_profiles row.
  // The anon client with a valid session cookie can read the user's own row
  // via RLS — if it returns null the logged-in user is a buyer, not the producer.
  if (user && (isProtectedPath || path === '/login')) {
    if (!(await isProducer(user.id))) {
      // A label member who is not the producer lands in their label (or on
      // the `next` they came for, if it is a Label OS page), not on the buyer
      // account. Flag off: exactly as before.
      if (isLabelOsEnabled() && (await hasAnyLabelOsMembership(supabase, user.id))) {
        const target = memberLanding(path, request.nextUrl.searchParams.get('next'));
        return NextResponse.redirect(new URL(target, request.url));
      }
      // Neither the producer nor a member: with Label OS on, /setup, where a
      // new artist or label creates its org (lib/labelos/setup.ts
      // #nonMemberLanding). Flag off: the buyer account, as before.
      const target = nonMemberLanding({ labelOsEnabled: isLabelOsEnabled(), metadata: user.user_metadata });
      return NextResponse.redirect(new URL(target, request.url));
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
  // `share` must be a whole segment: as a bare prefix it also skipped
  // `/shared` (LABEL-21, "Shared with me"), which needs the flag check, the
  // session refresh and the membership gate like every Label OS page.
  // The static-extension skip excludes the Label OS namespaces (and the platform console's, LABEL-47): `/api/org/…/x.png`
  // would otherwise run with no LABEL_OS_ENABLED check and no membership gate.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|share(?:/|$)|(?!api/org/|api/platform/|o/|platform/|shared/|join/|restore/).*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)',
  ],
};
