import { describe, expect, it, vi, beforeEach } from 'vitest';

const captured: { element: unknown } = { element: null };
let coverUrl: string | null = null;

vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(element: unknown) { captured.element = element; return new Response('png') as unknown as object; }
  },
}));
vi.mock('@/lib/local-store', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'tracks'
              ? { title: 'Beat', cover_url: coverUrl, user_id: 'u1' }
              : { display_name: 'Prod', accent_color: '#ffffff', share_card_style: null },
          }),
        }),
      }),
    }),
  }),
}));

import { GET } from './route';
import { NextRequest } from 'next/server';

function urls(node: unknown, out: string[] = []): string[] {
  out.push(JSON.stringify(node, (_k, v) => (typeof v === 'function' ? undefined : v)));
  return out;
}

describe('GET /api/store/share-card cover redaction', () => {
  beforeEach(() => { captured.element = null; });

  for (const format of ['story', 'og']) {
    it(`never draws an r2:// or signed cover (${format})`, async () => {
      for (const bad of ['r2://priv/cover.jpg', 'https://b.r2.cloudflarestorage.com/k?X-Amz-Signature=abc']) {
        coverUrl = bad;
        await GET(new NextRequest(`http://x/api/store/share-card?track_id=t&format=${format}`));
        const json = urls(captured.element).join('');
        expect(json).not.toContain('r2://');
        expect(json).not.toContain('X-Amz-Signature');
      }
    });
  }

  it('still draws a public cover', async () => {
    coverUrl = 'https://cdn.example.com/c.jpg';
    await GET(new NextRequest('http://x/api/store/share-card?track_id=t&format=og'));
    expect(urls(captured.element).join('')).toContain('https://cdn.example.com/c.jpg');
  });
});
