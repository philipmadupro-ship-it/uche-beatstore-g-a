import type { MetadataRoute } from 'next';
import { getAppUrl } from '@/lib/env';

/**
 * Crawl rules.
 *
 * The store had no robots.txt at all, so crawlers had no sitemap pointer and no
 * guidance about which routes are worth indexing. Everything private is
 * disallowed explicitly rather than relying on auth alone: the dashboard is
 * behind a session, but post-purchase delivery links are tokenised URLs that
 * would otherwise be crawlable if one ever leaked into a referrer header.
 */
export default function robots(): MetadataRoute.Robots {
  const base = getAppUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          // Auth-gated producer surfaces — no value to a searcher.
          '/library', '/projects', '/playlists', '/studio', '/contacts',
          '/calendar', '/links', '/campaigns', '/settings', '/sales',
          '/analytics', '/profile', '/store-editor', '/offline', '/cover-art',
          // Tokenised, per-buyer, and sometimes single-use. Never index.
          '/store/download', '/store/orders', '/store/account',
          '/store/projects/access', '/share', '/projects/share',
          // Checkout is transactional, not content.
          '/store/checkout',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
