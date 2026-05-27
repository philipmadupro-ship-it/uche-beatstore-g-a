import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/store/share-card?track_id=<uuid>&kind=licensed|playing
 *
 * Returns a 1080×1920 PNG (Instagram Stories aspect) for buyers to
 * share. Two variants:
 *
 *   - kind=licensed (default) "I just licensed <track> from <producer>"
 *   - kind=playing            "Now playing <track> by <producer>"
 *
 * Uses Next.js's built-in ImageResponse so we don't ship a heavy
 * canvas/Skia/Puppeteer dependency. Cache-Controlled aggressively
 * because output is determined entirely by the track_id + kind.
 *
 * Returns a placeholder card on lookup failure rather than 404 so
 * the share button on the storefront never breaks mid-action.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const trackId = searchParams.get('track_id');
  const kind = (searchParams.get('kind') ?? 'licensed') as 'licensed' | 'playing';

  let title = 'Untitled Track';
  let producer = 'U2C Beatstore';
  let cover: string | null = null;
  let accent = '#D4BFA0';

  if (trackId && isSupabaseConfigured()) {
    try {
      const admin = createServiceClient();
      const { data: track } = await admin
        .from('tracks')
        .select('title, cover_url, user_id')
        .eq('id', trackId)
        .maybeSingle();
      if (track) {
        title = (track as any).title || title;
        cover = (track as any).cover_url ?? null;
        const sellerId = (track as any).user_id;
        if (sellerId) {
          const { data: prof } = await admin
            .from('creator_profiles')
            .select('display_name, accent_color')
            .eq('user_id', sellerId)
            .maybeSingle();
          producer = (prof as any)?.display_name ?? producer;
          accent = (prof as any)?.accent_color || accent;
        }
      }
    } catch {/* fall through to defaults */}
  }

  const eyebrow = kind === 'playing' ? 'Now playing' : 'Just licensed';

  return new ImageResponse(
    (
      <div
        style={{
          width: '1080px',
          height: '1920px',
          display: 'flex',
          flexDirection: 'column',
          background: '#0a0907',
          color: '#E8DCC8',
          position: 'relative',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Backdrop cover blur */}
        {cover ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${cover})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: 0.35,
              filter: 'blur(60px)',
              transform: 'scale(1.15)',
            }}
          />
        ) : null}

        {/* Accent gradient overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(180deg, ${accent}40 0%, rgba(10,9,7,0.92) 50%, #0a0907 100%)`,
          }}
        />

        {/* Foreground */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-end',
            flex: 1,
            padding: '120px 80px 200px',
            textAlign: 'center',
          }}
        >
          {/* Eyebrow */}
          <div
            style={{
              fontSize: 28,
              letterSpacing: 8,
              textTransform: 'uppercase',
              color: accent,
              marginBottom: 60,
              fontWeight: 600,
            }}
          >
            {eyebrow}
          </div>

          {/* Cover thumbnail */}
          <div
            style={{
              display: 'flex',
              width: 600,
              height: 600,
              borderRadius: 40,
              overflow: 'hidden',
              background: '#14110d',
              boxShadow: '0 60px 120px rgba(0,0,0,0.6)',
              marginBottom: 80,
              border: '4px solid rgba(255,255,255,0.06)',
            }}
          >
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt=""
                width={600}
                height={600}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, #2A2418, #0a0907)',
                  color: '#5a5142',
                  fontSize: 96,
                }}
              >
                ♫
              </div>
            )}
          </div>

          {/* Track title */}
          <div
            style={{
              fontSize: 80,
              fontWeight: 800,
              color: '#FFFFFF',
              lineHeight: 1.05,
              maxWidth: 920,
              wordBreak: 'break-word',
              marginBottom: 32,
            }}
          >
            {title}
          </div>

          {/* Producer line */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'center',
              gap: 12,
              fontSize: 36,
              color: 'rgba(255,255,255,0.85)',
              letterSpacing: 2,
            }}
          >
            <span>prod.</span>
            <span style={{ color: accent, fontWeight: 600 }}>{producer}</span>
          </div>
        </div>

        {/* Bottom corner brand */}
        <div
          style={{
            position: 'absolute',
            bottom: 80,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            fontSize: 22,
            letterSpacing: 10,
            color: 'rgba(255,255,255,0.45)',
            textTransform: 'uppercase',
          }}
        >
          U2C Beatstore · /store
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1920,
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    },
  );
}
