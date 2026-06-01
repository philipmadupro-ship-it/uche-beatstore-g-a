/**
 * Shared client + server contracts.
 *
 * Until now every route declared its own `const Body = z.object(...)`
 * inline. Clients sent fetch bodies blindly — when a contract drifted
 * the failure was a 400 with a server-side reason the client couldn't
 * preview against.
 *
 * Hosting the schemas here lets:
 *   - Routes import them as the source of truth.
 *   - Clients import them to validate BEFORE sending, surface field-level
 *     errors in the UI, and stay type-safe end-to-end via z.infer.
 *
 * Convention: every export pair is `XSchema` (Zod) + `X` (the inferred TS
 * type). e.g. `RateBodySchema` and `RateBody = z.infer<typeof RateBodySchema>`.
 */
import { z } from 'zod';

// ── Tracks ──────────────────────────────────────────────────────────────

export const RateBodySchema = z.object({
  rating: z.number().int().min(0).max(5),
});
export type RateBody = z.infer<typeof RateBodySchema>;

export const LyricsSaveBodySchema = z.object({
  content: z.string(),
  snapshot: z.boolean().optional(),
});
export type LyricsSaveBody = z.infer<typeof LyricsSaveBodySchema>;

export const TagCreateBodySchema = z.object({
  tag: z.string().min(1).max(80),
  category: z.string().max(40).optional(),
});
export type TagCreateBody = z.infer<typeof TagCreateBodySchema>;

export const TagDeleteBodySchema = z.object({
  tag: z.string().min(1),
});
export type TagDeleteBody = z.infer<typeof TagDeleteBodySchema>;

// PATCH /api/tracks/[id] — allow-list editable columns. Anything not
// in this schema is dropped by readBody, which prevents callers from
// writing to internal columns (user_id, id, analyze_status) or
// triggering DB-level "column does not exist" errors.
export const TrackPatchBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  type: z.enum(['beat', 'instrumental', 'song', 'remix']).optional(),
  // Instrumental (no vocals) flag — distinct from `type` (migration 079).
  instrumental: z.boolean().optional(),
  status: z.enum(['finished', 'needs_work', 'archived', 'maq']).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  cover_url: z.string().nullable().optional(),
  peaks_url: z.string().nullable().optional(),
  bpm: z.number().nullable().optional(),
  key: z.string().nullable().optional(),
  scale: z.string().nullable().optional(),
  loudness: z.number().nullable().optional(),
  rating: z.number().int().min(0).max(5).nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
  energy: z.number().nullable().optional(),
  danceability: z.number().nullable().optional(),
  valence: z.number().nullable().optional(),
  acousticness: z.number().nullable().optional(),
  // Per-track listing fields (migration 021). NULL on either price
  // inherits the producer's profile default.
  description: z.string().max(5000).nullable().optional(),
  lease_price_usd: z.number().nonnegative().nullable().optional(),
  exclusive_price_usd: z.number().nonnegative().nullable().optional(),
  store_listed: z.boolean().optional(),
  // Exclusive-sold lock (mig 075). Set true by the webhook on exclusive sale;
  // the producer can clear it here to re-list.
  exclusive_sold: z.boolean().optional(),
  // Producer-curated "Picks" badge on /store. Independent of store_listed
  // (must be listed to appear; not all listed tracks are picks). Migration 054.
  store_featured: z.boolean().optional(),
  free_download_enabled: z.boolean().optional(),
  // Overlay the producer's voice tag on this beat's store preview (mig 072).
  voice_tag_enabled: z.boolean().optional(),
  store_sort_order: z.number().int().nullable().optional(),
  // Scheduled publish (migration 056). When set on a draft, the cron
  // route /api/cron/publish-scheduled flips store_listed=true at that
  // timestamp and clears this field. Null clears any pending schedule.
  scheduled_publish_at: z.string().datetime().nullable().optional(),
}).strict();
export type TrackPatchBody = z.infer<typeof TrackPatchBodySchema>;

// ── Projects ────────────────────────────────────────────────────────────

export const PROJECT_STATUSES = ['in_progress', 'final', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ProjectPatchBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  cover_url: z.string().nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  bpm_target: z.number().nullable().optional(),
  key_target: z.string().nullable().optional(),
  store_featured: z.boolean().optional(),
  store_order: z.number().nullable().optional(),
  price_usd: z.number().nonnegative().nullable().optional(),
  is_public: z.boolean().optional(),
}).strict();
export type ProjectPatchBody = z.infer<typeof ProjectPatchBodySchema>;

// ── Project folders (multi-membership collections) ───────────────────────
export const FolderCreateBodySchema = z.object({
  name: z.string().min(1).max(120),
}).strict();
export type FolderCreateBody = z.infer<typeof FolderCreateBodySchema>;

export const FolderPatchBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  position: z.number().int().optional(),
}).strict();
export type FolderPatchBody = z.infer<typeof FolderPatchBodySchema>;

// PUT /api/projects/[id]/folders — replace the project's folder membership set.
export const ProjectFoldersSetBodySchema = z.object({
  folder_ids: z.array(z.string().uuid()).max(200),
}).strict();
export type ProjectFoldersSetBody = z.infer<typeof ProjectFoldersSetBodySchema>;


export const ProjectCommentCreateBodySchema = z.object({
  body: z.string().min(1).max(5000),
  track_id: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  author_name: z.string().max(120).optional(),
  // Region anchor — both-or-neither enforced server-side too.
  region_start: z.number().nonnegative().nullable().optional(),
  region_end: z.number().positive().nullable().optional(),
});
export type ProjectCommentCreateBody = z.infer<typeof ProjectCommentCreateBodySchema>;

export const ProjectTracksAddBodySchema = z.object({
  track_ids: z.array(z.string()).min(1),
});
export type ProjectTracksAddBody = z.infer<typeof ProjectTracksAddBodySchema>;

export const ProjectTracksDeleteBodySchema = z.object({
  track_id: z.string().min(1),
});
export type ProjectTracksDeleteBody = z.infer<typeof ProjectTracksDeleteBodySchema>;

// ── Project shares ──────────────────────────────────────────────────────

export const SHARE_ROLES = ['viewer', 'commenter', 'editor'] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

export const ProjectShareCreateBodySchema = z.object({
  role: z.enum(SHARE_ROLES).optional(),
  allow_downloads: z.boolean().optional(),
  expires_days: z.number().int().min(0).max(365).optional(),
  password: z.string().min(1).max(200).optional().nullable(),
  invited_email: z.string().email().optional().nullable(),
  label: z.string().max(200).optional().nullable(),
  recipient_kind: z.enum(['client', 'producer', 'rapper', 'friend']).optional(),
  // When true the share page renders Buy buttons on the license
  // card (Stripe Checkout). Off by default so a producer doesn't
  // accidentally turn a casual send into a storefront.
  sales_enabled: z.boolean().optional(),
});
export type ProjectShareCreateBody = z.infer<typeof ProjectShareCreateBodySchema>;

export const ProjectSharePatchBodySchema = z.object({
  allow_downloads: z.boolean().optional(),
  role: z.enum(SHARE_ROLES).optional(),
  label: z.string().optional(),
  invited_email: z.string().optional(),
  revoke: z.boolean().optional(),
});
export type ProjectSharePatchBody = z.infer<typeof ProjectSharePatchBodySchema>;

// ── Playlists ───────────────────────────────────────────────────────────

export const PlaylistPatchBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  // Migration 061 — curator's note shown on /store/playlists/[id]
  description: z.string().max(2000).nullable().optional(),
  cover_url: z.string().nullable().optional(),
  store_featured: z.boolean().optional(),
  store_order: z.number().int().nullable().optional(),
}).strict();
export type PlaylistPatchBody = z.infer<typeof PlaylistPatchBodySchema>;

export const PlaylistTracksAddBodySchema = z.object({
  track_ids: z.array(z.string()).min(1),
});
export type PlaylistTracksAddBody = z.infer<typeof PlaylistTracksAddBodySchema>;

export const PlaylistTracksDeleteBodySchema = z.object({
  track_id: z.string().min(1),
});
export type PlaylistTracksDeleteBody = z.infer<typeof PlaylistTracksDeleteBodySchema>;

export const PlaylistTracksReorderBodySchema = z.object({
  track_ids: z.array(z.string()),
});
export type PlaylistTracksReorderBody = z.infer<typeof PlaylistTracksReorderBodySchema>;

// ── Beat sends ──────────────────────────────────────────────────────────

export const BEAT_SEND_STATUSES = [
  'sent', 'opened', 'interested', 'negotiating', 'placed', 'pass',
] as const;
export type BeatSendStatus = (typeof BEAT_SEND_STATUSES)[number];

export const BeatSendPatchBodySchema = z.object({
  status: z.enum(BEAT_SEND_STATUSES).optional(),
  message: z.string().max(5000).optional(),
});
export type BeatSendPatchBody = z.infer<typeof BeatSendPatchBodySchema>;

// ── License purchases ──────────────────────────────────────────────────
// license_purchases.line_items is a JSON column the Stripe webhook writes
// from cart_items metadata. Stripe metadata caps each value at 500 chars
// so cart_items is also size-capped at insert. These schemas let
// consumers (/api/sales, /api/analytics, future delivery checks) validate
// rows on read instead of trusting whatever the webhook last wrote.

export const PurchaseLineItemSchema = z.object({
  track_id: z.string().min(1),
  license_id: z.string().min(1),
  license_type: z.enum(['lease', 'exclusive']),
});
export type PurchaseLineItem = z.infer<typeof PurchaseLineItemSchema>;

export const PurchaseLineItemsSchema = z.array(PurchaseLineItemSchema);

/**
 * Safe parser for the `line_items` JSON column. Returns an empty array
 * for any malformed row so callers don't have to wrap their reads in
 * try/catch. Logs unknown shapes once via the caller's logger.
 */
export function parsePurchaseLineItems(raw: unknown): PurchaseLineItem[] {
  const parsed = PurchaseLineItemsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Older rows can be `null` or use a different shape; treat as empty.
  return [];
}
