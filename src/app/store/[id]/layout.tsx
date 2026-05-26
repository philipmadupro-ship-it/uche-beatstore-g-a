import type { Metadata } from 'next';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { getAppUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const fallback: Metadata = { title: 'Beat — U2C Beatstore' };
  if (!isSupabaseConfigured()) return fallback;

  try {
    const admin = createServiceClient();
    const { data: track } = await admin
      .from('tracks')
      .select('title, cover_url, description, bpm, key, scale, user_id, store_listed')
      .eq('id', id)
      .eq('store_listed', true)
      .maybeSingle();

    if (!track) return fallback;

    const t = track as any;
    let displayName: string | null = null;
    if (t.user_id) {
      const { data: prof } = await admin
        .from('creator_profiles')
        .select('display_name')
        .eq('user_id', t.user_id)
        .maybeSingle();
      displayName = (prof as any)?.display_name ?? null;
    }

    const title = displayName ? `${t.title} — ${displayName}` : t.title;
    const meta = [t.bpm ? `${t.bpm} BPM` : null, [t.key, t.scale].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(' · ');
    const description = t.description?.trim() || meta || 'Listen and license on U2C Beatstore.';
    const url = `${getAppUrl()}/store/${id}`;
    const images = t.cover_url ? [{ url: t.cover_url }] : undefined;

    return {
      title,
      description,
      openGraph: { title, description, url, images, type: 'music.song' },
      twitter: { card: 'summary_large_image', title, description, images: t.cover_url ? [t.cover_url] : undefined },
    };
  } catch {
    return fallback;
  }
}

export default function StoreTrackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
