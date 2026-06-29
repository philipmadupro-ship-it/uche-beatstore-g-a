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
import { STORE_EVENT_TYPES } from '@/lib/store/funnel';

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
  // Template slug + checklist (mig 084)
  template: z.string().max(40).nullable().optional(),
  checklist: z.array(z.object({
    id: z.string(),
    label: z.string().max(200),
    done: z.boolean(),
  })).max(50).nullable().optional(),
  // Pin/favorite (mig 085)
  pinned: z.boolean().optional(),
}).strict();

export type ProjectPatchBody = z.infer<typeof ProjectPatchBodySchema>;

// ── Project folders (multi-membership collections) ───────────────────────
export const FolderCreateBodySchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().max(20).nullable().optional(),
  cover_url: z.string().nullable().optional(),
}).strict();
export type FolderCreateBody = z.infer<typeof FolderCreateBodySchema>;

export const FolderPatchBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  position: z.number().int().optional(),
  color: z.string().max(20).nullable().optional(),
  cover_url: z.string().nullable().optional(),
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
  pinned: z.boolean().optional(),
}).strict();
export type PlaylistPatchBody = z.infer<typeof PlaylistPatchBodySchema>;

// ── Playlist folders (mig 087-088) ───────────────────────────────────────
export const PlaylistFolderCreateBodySchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().max(20).nullable().optional(),
}).strict();
export type PlaylistFolderCreateBody = z.infer<typeof PlaylistFolderCreateBodySchema>;

export const PlaylistFolderPatchBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  position: z.number().int().optional(),
  color: z.string().max(20).nullable().optional(),
}).strict();
export type PlaylistFolderPatchBody = z.infer<typeof PlaylistFolderPatchBodySchema>;

export const PlaylistFoldersSetBodySchema = z.object({
  folder_ids: z.array(z.string().uuid()).max(200),
}).strict();
export type PlaylistFoldersSetBody = z.infer<typeof PlaylistFoldersSetBodySchema>;

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

// ── Campaigns ───────────────────────────────────────────────────────────

export const CampaignPatchBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  nudge_after_days: z.number().int().min(1).max(60).nullable().optional(),
}).strict();
export type CampaignPatchBody = z.infer<typeof CampaignPatchBodySchema>;

export const CampaignTargetsAddBodySchema = z.object({
  contact_ids: z.array(z.string().uuid()).min(1).max(200),
});
export type CampaignTargetsAddBody = z.infer<typeof CampaignTargetsAddBodySchema>;

export const CampaignTargetsDeleteBodySchema = z.object({
  contact_id: z.string().uuid(),
});
export type CampaignTargetsDeleteBody = z.infer<typeof CampaignTargetsDeleteBodySchema>;

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

// ── Contact segments (mig 090) — saved CRM filter combos ──────────────────
export const ContactSegmentFiltersSchema = z.object({
  search: z.string().max(200).optional(),
  category: z.string().max(40).optional(),
  status: z.enum(['all', 'active', 'engaged', 'cold']).optional(),
  sort: z.enum(['recent', 'name', 'category']).optional(),
}).strict();
export type ContactSegmentFilters = z.infer<typeof ContactSegmentFiltersSchema>;

export const ContactSegmentCreateBodySchema = z.object({
  name: z.string().min(1).max(60),
  filters: ContactSegmentFiltersSchema,
}).strict();
export type ContactSegmentCreateBody = z.infer<typeof ContactSegmentCreateBodySchema>;

// ── Find-or-create a contact by email (ad-hoc send) ───────────────────────
export const ContactResolveBodySchema = z.object({
  email: z.string().email().max(200),
  name: z.string().max(120).optional(),
}).strict();
export type ContactResolveBody = z.infer<typeof ContactResolveBodySchema>;

// ── CRM lifecycle stage (mig 092) ─────────────────────────────────────────
// Editable, stored. Distinct from the auto-computed activity tone.
export const CRM_STAGES = ['prospect', 'active', 'engaged', 'cold', 'archived'] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

// Batch edit a set of contacts (stage and/or category).
export const ContactsBatchPatchBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  patch: z.object({
    crm_status: z.enum(CRM_STAGES).nullable().optional(),
    category: z.string().max(40).nullable().optional(),
  }).strict(),
}).strict();
export type ContactsBatchPatchBody = z.infer<typeof ContactsBatchPatchBodySchema>;

// Bulk add/remove tags across many contacts in one request.
export const ContactsBulkTagsBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  add: z.array(z.string().min(1).max(40)).max(50).optional(),
  remove: z.array(z.string().min(1).max(40)).max(50).optional(),
}).strict();
export type ContactsBulkTagsBody = z.infer<typeof ContactsBulkTagsBodySchema>;

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

// ── Stems ────────────────────────────────────────────────────────────────
// POST /api/stems — kick off a Demucs/Moises split. Gated on track
// ownership; validated so a bad body 400s instead of throwing on a
// missing field deep in the dispatcher.
export const StemStartBodySchema = z.object({
  trackId: z.string().min(1),
  audioUrl: z.string().min(1).max(2000),
  model: z.string().max(40).optional(),
});
export type StemStartBody = z.infer<typeof StemStartBodySchema>;

// ── Invites ──────────────────────────────────────────────────────────────
// POST /api/invite — team invite. Role mirrors the settings UI's options.
export const INVITE_ROLES = ['admin', 'collaborator'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const InviteCreateBodySchema = z.object({
  email: z.string().email().max(200),
  role: z.enum(INVITE_ROLES),
}).strict();
export type InviteCreateBody = z.infer<typeof InviteCreateBodySchema>;

// ── Share links ──────────────────────────────────────────────────────────
// POST /api/share — legacy track/project share-link creation.
export const ShareCreateBodySchema = z.object({
  track_ids: z.array(z.string().min(1)).min(1),
  title: z.string().max(200).nullish(),
  cover_url: z.string().max(2000).nullish(),
  project_id: z.string().nullish(),
  kind: z.enum(['track', 'project']).optional(),
  allow_downloads: z.boolean().optional(),
  expires_days: z.number().int().min(0).max(3650).optional(),
  password: z.string().min(1).max(200).nullish(),
  recipient_kind: z.enum(['client', 'producer', 'rapper', 'friend']).optional(),
});
export type ShareCreateBody = z.infer<typeof ShareCreateBodySchema>;

// ── Creator profile ────────────────────────────────────────────────────────
// POST/PATCH /api/profile. The form historically sent price + numeric fields
// as strings (the route parseFloat/Number-coerces), so those accept string OR
// number here. All fields optional; unknown keys are dropped (not .strict) so
// the route's existing whitelist-by-destructure stays the source of truth.
const numericLike = z.union([z.number(), z.string()]).nullish();
export const CreatorProfilePatchSchema = z.object({
  display_name: z.string().max(200).nullish(),
  bio: z.string().max(10000).nullish(),
  hero_image_url: z.string().max(2000).nullish(),
  credits: z.string().max(10000).nullish(),
  license_lease_price_usd: numericLike,
  license_exclusive_price_usd: numericLike,
  license_notes: z.string().max(10000).nullish(),
  license_agreement: z.string().max(50000).nullish(),
  default_discount_percent: numericLike,
  instagram_handle: z.string().max(200).nullish(),
  twitter_handle: z.string().max(200).nullish(),
  spotify_url: z.string().max(2000).nullish(),
  soundcloud_url: z.string().max(2000).nullish(),
  website_url: z.string().max(2000).nullish(),
  contact_email: z.string().max(200).nullish(),
  accent_color: z.string().max(40).nullish(),
  font_style: z.string().max(40).nullish(),
  seo_title: z.string().max(200).nullish(),
  seo_description: z.string().max(500).nullish(),
  og_image_url: z.string().max(2000).nullish(),
  license_template_md: z.string().max(50000).nullish(),
  share_card_style: z.string().max(40).nullish(),
  share_video_style: z.string().max(40).nullish(),
  lossless_exports: z.boolean().optional(),
  auto_tagging: z.boolean().optional(),
  voice_tag_url: z.string().max(2000).nullish(),
  voice_tag_interval_seconds: numericLike,
  bundle_discount_threshold: numericLike,
  bundle_discount_percent: numericLike,
});
export type CreatorProfilePatch = z.infer<typeof CreatorProfilePatchSchema>;

// ── Contact import (JSON branch) ──────────────────────────────────────────
// POST /api/contacts/import with { contacts: [...] }. The multipart branch
// re-parses a file server-side and is validated there; this schema guards
// the pre-parsed JSON list. Only `name` is required (mirrors ParsedContact).
export const ContactImportItemSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  role: z.string().max(80).optional(),
  label: z.string().max(80).optional(),
  category: z.string().max(80).optional(),
  genre: z.string().max(80).optional(),
  country: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  instagram: z.string().max(200).optional(),
  twitter: z.string().max(200).optional(),
  website: z.string().max(2000).optional(),
  notes: z.string().max(10000).optional(),
}).passthrough();
export type ContactImportItem = z.infer<typeof ContactImportItemSchema>;

export const ContactImportBodySchema = z.object({
  contacts: z.array(ContactImportItemSchema).min(1).max(5000),
});
export type ContactImportBody = z.infer<typeof ContactImportBodySchema>;

// ── Buyer data erasure (GDPR) ───────────────────────────────────────────────
// POST /api/privacy/erase — producer-initiated anonymisation of a buyer's PII
// across their purchase records. Email is the only buyer identifier we hold.
export const ErasureRequestSchema = z.object({
  email: z.string().email().max(200),
}).strict();
export type ErasureRequest = z.infer<typeof ErasureRequestSchema>;

// ── Storefront funnel events ───────────────────────────────────────────────
// POST /api/store/event — public, fire-and-forget telemetry. event_type is
// constrained to the known funnel vocabulary; metadata is a bounded free-form
// payload (cart contents, amount, source surface). Everything else optional so
// a lost field never drops a whole event.
export const StoreEventBodySchema = z.object({
  event_type: z.enum(STORE_EVENT_TYPES),
  session_id: z.string().min(1).max(100),
  track_id: z.string().max(100).optional(),
  license_id: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type StoreEventBody = z.infer<typeof StoreEventBodySchema>;
