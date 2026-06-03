/**
 * Shared shapes for the /store surfaces. Extracted from src/app/store/page.tsx
 * so that each sub-component can be imported independently without dragging
 * the whole 2k-line page in.
 */
import type { Track } from '@/lib/types';
import type { LicenseTier as LicenseTierImport } from '@/components/store/LicenseSelector';

export interface TrackTag {
  tag: string;
  category: string | null;
}

export type LicenseTier = LicenseTierImport;

export interface CreatorProfile {
  display_name?: string | null;
  bio?: string | null;
  hero_image_url?: string | null;
  credits?: string | null;
  license_lease_price_usd?: number | null;
  license_exclusive_price_usd?: number | null;
  license_notes?: string | null;
  instagram_handle?: string | null;
  twitter_handle?: string | null;
  spotify_url?: string | null;
  soundcloud_url?: string | null;
  website_url?: string | null;
  contact_email?: string | null;
  accent_color?: string | null;
  font_style?: string | null;
  text_color_primary?: string | null;
}

export interface PlaylistTrackItem {
  id: string;
  title: string;
  type: string;
  audio_url: string;
  peaks_url?: string | null;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  lease_price_usd?: number | null;
  exclusive_price_usd?: number | null;
  free_download_enabled?: boolean | null;
  /** Exclusive license already sold (mig 075) — show "Exclusive Sold" badge,
   *  hide buy options. */
  exclusive_sold?: boolean | null;
}

export interface FeaturedPlaylist {
  id: string;
  name: string;
  cover_url: string | null;
  store_order: number | null;
  tracks: PlaylistTrackItem[];
}

export interface StoreTrack extends Track {
  tags?: TrackTag[];
}

export const TYPE_FILTERS = ['all', 'beats', 'song', 'remix'] as const;
export type TypeFilter = typeof TYPE_FILTERS[number];
export type ViewMode = 'grid' | 'list';

export const FONT_FAMILY_MAP: Record<string, string> = {
  default: '"Akira Expanded", system-ui, sans-serif',
  serif: '"Synkopy", "Akira Expanded", system-ui, sans-serif',
  mono: '"Panchang", ui-monospace, SFMono-Regular, Menlo, monospace',
};
