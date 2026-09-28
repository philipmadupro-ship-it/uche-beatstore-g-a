/**
 * A signed-in producer for dashboard specs, without a real Supabase.
 *
 * The e2e job points NEXT_PUBLIC_SUPABASE_URL at http://127.0.0.1:54321 with
 * nothing listening, so `src/proxy.ts` sees no user and bounces every
 * dashboard page to /login. With no Supabase env at all the proxy lets pages
 * through, but pages that build a browser Supabase client (the project page's
 * comments panel, for one) crash instead. Either way a dashboard page could not
 * be rendered in a test.
 *
 * This answers just enough of that URL for the proxy to accept a producer:
 *   - GET /auth/v1/user           → the fixture user (proxy `getUser()`)
 *   - GET /rest/v1/creator_profiles → a row for that user (proxy `isProducer`)
 *   - any other /rest/v1 read     → empty
 * and `signInCookie` is the session cookie @supabase/ssr reads. Specs still
 * stub the /api/* data they depend on; this only gets them past the gate.
 *
 * Nothing is authorised by this outside the test: it is a local HTTP server
 * the spec starts and stops, on the URL CI already configures.
 */
import http from 'node:http';

export const STUB_SUPABASE_URL = 'http://127.0.0.1:54321';
export const FIXTURE_USER_ID = 'local-user';

const user = {
  id: FIXTURE_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'producer@e2e.test',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
};

/** True when the app under test is configured for the stub's URL. */
export function stubSupabaseConfigured(): boolean {
  return process.env.NEXT_PUBLIC_SUPABASE_URL === STUB_SUPABASE_URL;
}

export async function startStubSupabase(): Promise<{ close: () => Promise<void> } | null> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', STUB_SUPABASE_URL);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
      });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') return send(204, undefined);
    if (url.pathname === '/auth/v1/user') return send(200, user);
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.slice('/rest/v1/'.length);
      const rows = table === 'creator_profiles' ? [{ user_id: FIXTURE_USER_ID }] : [];
      const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object');
      if (!wantsObject) return send(200, rows);
      return rows.length
        ? send(200, rows[0])
        : send(406, { code: 'PGRST116', message: 'no rows', details: null, hint: null });
    }
    return send(404, { message: 'not stubbed' });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(new URL(STUB_SUPABASE_URL).port), '127.0.0.1', () => resolve());
    });
  } catch {
    // Port taken: something else (maybe a real local Supabase) owns it.
    return null;
  }
  return { close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** The @supabase/ssr session cookie for the fixture user. */
export function signInCookie(baseURL: string) {
  const ref = new URL(STUB_SUPABASE_URL).hostname.split('.')[0];
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: 'e2e-access-token',
    refresh_token: 'e2e-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user,
  };
  return {
    name: `sb-${ref}-auth-token`,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`,
    url: baseURL,
  };
}
