/**
 * The API producer gate in src/proxy.ts. Buyers share the producer's Supabase
 * auth, so a signed-in buyer must be refused on dashboard API routes while
 * storefront/share routes and signed-out requests pass through untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let currentUser: { id: string } | null = null;
let producerIds = new Set<string>();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({ data: producerIds.has(id) ? { user_id: id } : null }),
        }),
      }),
    }),
  }),
}));

async function run(path: string) {
  const { proxy } = await import('./proxy');
  return proxy(new NextRequest(`https://example.test${path}`));
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.example.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  currentUser = null;
  producerIds = new Set(['producer-1']);
});

describe('proxy API producer gate', () => {
  it('refuses a signed-in buyer on dashboard API routes', async () => {
    currentUser = { id: 'buyer-1' };
    for (const path of ['/api/email', '/api/tracks', '/api/upload/init', '/api/sales', '/api/team']) {
      const res = await run(path);
      expect(res.status, path).toBe(403);
    }
  });

  it('lets a signed-in buyer use storefront and share routes', async () => {
    currentUser = { id: 'buyer-1' };
    for (const path of ['/api/store/me', '/api/store/checkout', '/api/share/tok', '/api/tracks/t1/heatmap']) {
      const res = await run(path);
      expect(res.status, path).toBe(200);
    }
  });

  it('lets the producer through', async () => {
    currentUser = { id: 'producer-1' };
    expect((await run('/api/email')).status).toBe(200);
  });

  it('leaves signed-out requests to the route (cron bearer, 401s)', async () => {
    expect((await run('/api/cron/process-uploads')).status).toBe(200);
    expect((await run('/api/email')).status).toBe(200);
  });
});
