import type { Metadata } from 'next';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { getAppUrl } from '@/lib/env';
import { slugify } from '@/lib/slug';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug).trim().toLowerCase();
  const fallback: Metadata = { title: 'Producer — U2C Beatstore' };
  if (!decoded || !isSupabaseConfigured()) return fallback;

  try {
    const admin = createServiceClient();

    let { data: creator } = await admin
      .from('creator_profiles')
      .select('display_name, bio, hero_image_url')
      .eq('slug', decoded)
      .maybeSingle();

    if (!creator) {
      const { data: candidates } = await admin
        .from('creator_profiles')
        .select('display_name, bio, hero_image_url')
        .not('display_name', 'is', null);
      creator =
        (candidates ?? []).find(
          (c: any) => slugify(c.display_name || '') === decoded,
        ) ?? null;
    }

    if (!creator) return fallback;

    const c = creator as any;
    const title = c.display_name ? `${c.display_name} — beats + samples` : 'Producer';
    const description = c.bio?.trim() || `Listen, license, and follow ${c.display_name || 'this producer'}.`;
    const url = `${getAppUrl()}/store/producer/${slug}`;
    const images = c.hero_image_url ? [{ url: c.hero_image_url }] : undefined;

    return {
      title,
      description,
      openGraph: { title, description, url, images, type: 'profile' },
      twitter: { card: 'summary_large_image', title, description, images: c.hero_image_url ? [c.hero_image_url] : undefined },
    };
  } catch {
    return fallback;
  }
}

export default function ProducerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
