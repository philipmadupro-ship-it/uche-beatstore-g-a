import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { asCardStyle, type CardStyle } from '@/lib/share/styles';
import { normalizeThemeColor } from '@/lib/theme/colors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/store/share-card?track_id=<uuid>&kind=licensed|playing&style=<id>
 *
 * Returns a 1080×1920 PNG (Instagram Stories aspect). Four styles
 * shipping out the gate, each tuned to feel hand-designed:
 *   - minimal   centered cover + big title (default)
 *   - magazine  asymmetric split, cover bleeds right
 *   - mono      brutalist black/white + accent bar
 *   - glow      cover blurred behind a glowing title block
 *
 * `style` query param overrides the producer's saved preference;
 * if neither is set, falls back to `minimal`.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const trackId = searchParams.get('track_id');
  const kind = (searchParams.get('kind') ?? 'licensed') as 'licensed' | 'playing';
  const styleOverride = searchParams.get('style');

  let title = 'Untitled Track';
  let producer = 'U2C Beatstore';
  let cover: string | null = null;
  let accent = '#E7D7BE';
  let preferredStyle: string | null = null;

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
            .select('display_name, accent_color, share_card_style')
            .eq('user_id', sellerId)
            .maybeSingle();
          producer = (prof as any)?.display_name ?? producer;
          accent = normalizeThemeColor((prof as any)?.accent_color, accent);
          preferredStyle = (prof as any)?.share_card_style ?? null;
        }
      }
    } catch {/* defaults */}
  }

  const style = asCardStyle(styleOverride ?? preferredStyle);
  const eyebrow = kind === 'playing' ? 'Now playing' : 'Just licensed';

  return new ImageResponse(renderCard({ style, title, producer, cover, accent, eyebrow }), {
    width: 1080,
    height: 1920,
    headers: {
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}

interface RenderProps {
  style: CardStyle;
  title: string;
  producer: string;
  cover: string | null;
  accent: string;
  eyebrow: string;
}

function renderCard(props: RenderProps): React.ReactElement {
  switch (props.style) {
    case 'magazine': return Magazine(props);
    case 'mono':     return Mono(props);
    case 'glow':     return Glow(props);
    case 'minimal':
    default:         return Minimal(props);
  }
}

/* ───────── Style: minimal ─────────────────────────────────── */

function Minimal({ title, producer, cover, accent, eyebrow }: RenderProps) {
  return (
    <div style={{ width: 1080, height: 1920, display: 'flex', flexDirection: 'column', background: '#090907', color: '#F7EBDD', position: 'relative', fontFamily: 'sans-serif' }}>
      {cover && (
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.35, filter: 'blur(60px)', transform: 'scale(1.15)' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${accent}40 0%, rgba(10,9,7,0.92) 50%, #090907 100%)` }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', flex: 1, padding: '120px 80px 200px', textAlign: 'center' }}>
        <div style={{ fontSize: 28, letterSpacing: 8, textTransform: 'uppercase', color: accent, marginBottom: 60, fontWeight: 600 }}>{eyebrow}</div>
        <div style={{ display: 'flex', width: 600, height: 600, borderRadius: 40, overflow: 'hidden', background: '#171511', boxShadow: '0 60px 120px rgba(0,0,0,0.6)', marginBottom: 80, border: '4px solid rgba(255,255,255,0.06)' }}>
          {cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={cover} alt="" width={600} height={600} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <PlaceholderCover />}
        </div>
        <div style={{ fontSize: 80, fontWeight: 800, color: '#FFFFFF', lineHeight: 1.05, maxWidth: 920, wordBreak: 'break-word', marginBottom: 32 }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 12, fontSize: 36, color: 'rgba(255,255,255,0.85)', letterSpacing: 2 }}>
          <span>prod.</span><span style={{ color: accent, fontWeight: 600 }}>{producer}</span>
        </div>
      </div>
      <BrandStrip />
    </div>
  );
}

/* ───────── Style: magazine ────────────────────────────────── */

function Magazine({ title, producer, cover, accent, eyebrow }: RenderProps) {
  return (
    <div style={{ width: 1080, height: 1920, display: 'flex', background: '#090907', color: '#F7EBDD', position: 'relative', fontFamily: 'sans-serif', overflow: 'hidden' }}>
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" style={{ position: 'absolute', right: -120, top: 200, width: 1100, height: 1100, objectFit: 'cover', borderRadius: 30, boxShadow: '-40px 60px 120px rgba(0,0,0,0.7)', transform: 'rotate(-2deg)' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(10,9,7,0.95) 0%, rgba(10,9,7,0.85) 38%, rgba(10,9,7,0.0) 65%)' }} />
      <div style={{ position: 'absolute', top: 100, left: 80, width: 16, height: 220, background: accent, borderRadius: 999 }} />

      <div style={{ position: 'absolute', top: 100, left: 130, right: 80, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 22, letterSpacing: 8, textTransform: 'uppercase', color: accent, marginBottom: 24 }}>{eyebrow}</div>
        <div style={{ fontSize: 96, fontWeight: 900, lineHeight: 0.95, color: 'white', maxWidth: 700, wordBreak: 'break-word', textTransform: 'uppercase', letterSpacing: -2 }}>{title}</div>
      </div>

      <div style={{ position: 'absolute', bottom: 220, left: 80, right: 80, display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ width: 6, height: 60, background: accent }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 22, letterSpacing: 6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>Producer</div>
          <div style={{ fontSize: 48, fontWeight: 700, color: 'white' }}>{producer}</div>
        </div>
      </div>
      <BrandStrip />
    </div>
  );
}

/* ───────── Style: mono ────────────────────────────────────── */

function Mono({ title, producer, cover, accent, eyebrow }: RenderProps) {
  return (
    <div style={{ width: 1080, height: 1920, display: 'flex', flexDirection: 'column', background: '#090907', color: '#fff', fontFamily: 'sans-serif', position: 'relative' }}>
      <div style={{ height: 14, background: accent }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: 80, flex: 1 }}>
        <div style={{ fontSize: 22, letterSpacing: 10, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginBottom: 60 }}>{eyebrow}</div>
        <div style={{ display: 'flex', width: 920, height: 920, background: '#090907', border: '2px solid rgba(255,255,255,0.18)', overflow: 'hidden' }}>
          {cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(0.6) contrast(1.05)' }} />
            : <PlaceholderCover />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 60 }}>
          <div style={{ fontSize: 78, fontWeight: 900, lineHeight: 0.95, color: '#fff', textTransform: 'uppercase', letterSpacing: -1, maxWidth: 920, wordBreak: 'break-word' }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 36 }}>
            <div style={{ width: 60, height: 6, background: accent }} />
            <div style={{ fontSize: 32, letterSpacing: 4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)' }}>{producer}</div>
          </div>
        </div>
      </div>
      <div style={{ height: 14, background: accent }} />
    </div>
  );
}

/* ───────── Style: glow ────────────────────────────────────── */

function Glow({ title, producer, cover, accent, eyebrow }: RenderProps) {
  return (
    <div style={{ width: 1080, height: 1920, display: 'flex', flexDirection: 'column', background: '#090907', color: '#fff', fontFamily: 'sans-serif', position: 'relative', overflow: 'hidden' }}>
      {cover && (
        <div style={{ position: 'absolute', inset: -100, backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(80px) saturate(1.4)', opacity: 0.75 }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(10,9,7,0.3) 0%, rgba(10,9,7,0.85) 65%, #090907 100%)' }} />

      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 80, textAlign: 'center' }}>
        <div style={{ fontSize: 24, letterSpacing: 10, textTransform: 'uppercase', color: accent, marginBottom: 36 }}>{eyebrow}</div>
        <div style={{ display: 'flex', padding: '60px 80px', borderRadius: 36, background: 'rgba(10,9,7,0.55)', border: `2px solid ${accent}` }}>
          <div style={{ fontSize: 110, fontWeight: 900, lineHeight: 0.95, color: '#fff', letterSpacing: -2, maxWidth: 820, wordBreak: 'break-word' }}>{title}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 48, fontSize: 36 }}>
          <span style={{ color: 'rgba(255,255,255,0.7)' }}>prod.</span>
          <span style={{ color: accent, fontWeight: 700 }}>{producer}</span>
        </div>
      </div>
      <BrandStrip />
    </div>
  );
}

/* ───────── Atoms ──────────────────────────────────────────── */

function BrandStrip() {
  return (
    <div style={{ position: 'absolute', bottom: 80, left: 0, right: 0, display: 'flex', justifyContent: 'center', fontSize: 22, letterSpacing: 10, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase' }}>
      U2C Beatstore · /store
    </div>
  );
}

function PlaceholderCover() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #342F27, #090907)', color: '#9B9282', fontSize: 96 }}>
      ♫
    </div>
  );
}
