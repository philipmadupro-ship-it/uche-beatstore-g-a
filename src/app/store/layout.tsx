import type { Metadata } from 'next';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';
import { getAppUrl } from '@/lib/env';
import { StoreLayoutClient } from './StoreLayoutClient';

export const dynamic = 'force-dynamic';

interface StoreMetadataProfile {
  display_name: string | null;
  bio: string | null;
  hero_image_url: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  og_image_url?: string | null;
}

/**
 * Storefront-root metadata. Pulled from the populated creator_profile
 * (migration 055 fields with sensible fallbacks). Consumed by social
 * platforms when /store itself is shared — not when a specific track
 * or producer page is shared, which already have their own metadata
 * via their sibling layouts.
 */
export async function generateMetadata(): Promise<Metadata> {
  const fallback: Metadata = {
    title: 'U2C Beatstore',
    description: 'License beats, instrumentals, and project bundles from independent producers.',
    alternates: { canonical: `${getAppUrl()}/store` },
    robots: { index: true, follow: true },
  };
  if (!isSupabaseConfigured()) return fallback;

  try {
    const admin = createServiceClient();
    const { data } = await admin
      .from('creator_profiles')
      .select('display_name, bio, hero_image_url, seo_title, seo_description, og_image_url')
      .not('display_name', 'is', null)
      .order('display_name', { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    const c = data as StoreMetadataProfile | null;
    const title = c?.seo_title?.trim()
      || (c?.display_name ? `${c.display_name} — Beat store` : fallback.title!);
    const description = c?.seo_description?.trim()
      || c?.bio?.trim()
      || fallback.description!;
    const ogImage = c?.og_image_url || c?.hero_image_url || null;
    const url = `${getAppUrl()}/store`;
    const images = ogImage ? [{ url: ogImage }] : undefined;

    return {
      title: title as string,
      description: description as string,
      alternates: { canonical: url },
      robots: { index: true, follow: true },
      openGraph: {
        title: title as string,
        description: description as string,
        url,
        images,
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title: title as string,
        description: description as string,
        images: ogImage ? [ogImage] : undefined,
      },
    };
  } catch {
    return fallback;
  }
}

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <StoreLayoutClient>{children}</StoreLayoutClient>;
}
