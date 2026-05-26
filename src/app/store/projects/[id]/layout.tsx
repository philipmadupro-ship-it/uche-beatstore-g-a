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
  const fallback: Metadata = { title: 'Project bundle — U2C Beatstore' };
  if (!isSupabaseConfigured()) return fallback;

  try {
    const admin = createServiceClient();
    const { data: project } = await admin
      .from('projects')
      .select('name, description, cover_url, price_usd, user_id, store_featured')
      .eq('id', id)
      .eq('store_featured', true)
      .maybeSingle();

    if (!project) return fallback;

    const p = project as any;
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
    const price = p.price_usd != null && Number(p.price_usd) > 0 ? `$${p.price_usd} bundle` : null;
    const description = p.description?.trim() || price || 'Project bundle on U2C Beatstore.';
    const url = `${getAppUrl()}/store/projects/${id}`;
    const images = p.cover_url ? [{ url: p.cover_url }] : undefined;

    return {
      title,
      description,
      openGraph: { title, description, url, images, type: 'music.album' },
      twitter: { card: 'summary_large_image', title, description, images: p.cover_url ? [p.cover_url] : undefined },
    };
  } catch {
    return fallback;
  }
}

export default function ProjectBundleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
