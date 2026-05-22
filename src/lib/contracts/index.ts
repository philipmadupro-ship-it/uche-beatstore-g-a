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
  status: z.enum(['finished', 'needs_work', 'archived']).nullable().optional(),
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
  free_download_enabled: z.boolean().optional(),
  store_sort_order: z.number().int().nullable().optional(),
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
