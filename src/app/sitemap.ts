import type { MetadataRoute } from 'next';
import { getAppUrl } from '@/lib/env';
import { loadStoreCatalogue } from '@/lib/store/discovery-catalogue';

/**
 * Sitemap for the public storefront.
 *
 * There was no sitemap, so the only way into the catalogue was a link someone
 * was sent — search could not discover the individual beats at all. This lists
 * every store-listed track plus the generated discovery pages.
 *
 * Terms come from the SAME reader the landing routes use, so the sitemap can
 * never advertise a page that would 404. Repeatedly pointing crawlers at dead
 * URLs is how a site loses trust.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getAppUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/store`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/store/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.1 },
  ];

  const { tracks, terms } = await loadStoreCatalogue();

  const trackRoutes: MetadataRoute.Sitemap = tracks.map((t) => ({
    url: `${base}/store/${t.id}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  // Discovery pages rank above individual beats: they answer a broader query
  // and are the intended entry point into the catalogue.
  const termRoutes: MetadataRoute.Sitemap = terms.map((term) => ({
    url: `${base}/store/type/${term.slug}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.9,
  }));

  return [...staticRoutes, ...termRoutes, ...trackRoutes];
}
