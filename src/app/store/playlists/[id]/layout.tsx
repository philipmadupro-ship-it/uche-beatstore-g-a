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
  const fallback: Metadata = { title: 'Playlist — U2C Beatstore' };
  if (!isSupabaseConfigured()) return fallback;

  try {
    const admin = createServiceClient();
    const { data: playlist } = await admin
      .from('playlists')
      .select('name, cover_url, user_id, store_featured')
      .eq('id', id)
      .eq('store_featured', true)
      .maybeSingle();

    if (!playlist) return fallback;

    const p = playlist as any;
    let displayName: string | null = null;
    if (p.user_id) {
      const { data: prof } = await admin
        .from('creator_profiles')
        .select('display_name')
        .eq('user_id', p.user_id)
        .maybeSingle();
      displayName = (prof as any)?.display_name ?? null;
    }

    const title = displayName ? `${p.name} — ${displayName}` : p.name;
    const description = `A playlist of beats. Buy any track individually or grab the whole set.`;
    const url = `${getAppUrl()}/store/playlists/${id}`;
    const images = p.cover_url ? [{ url: p.cover_url }] : undefined;

    return {
      title,
      description,
      openGraph: { title, description, url, images, type: 'music.playlist' },
      twitter: { card: 'summary_large_image', title, description, images: p.cover_url ? [p.cover_url] : undefined },
    };
  } catch {
    return fallback;
  }
}

export default function PlaylistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
