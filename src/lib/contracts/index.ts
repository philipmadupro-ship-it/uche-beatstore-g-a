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
import { DECISIONS } from '@/lib/contacts/decisions';
import { ORG_UPLOAD_RELATIONS } from '@/lib/labelos/org-upload';
import { ASSET_SENSITIVITIES, ORG_ASSET_KINDS } from '@/lib/labelos/org-assets';
import { parseIdentifier, type IdentifierKind } from '@/lib/labelos/identifiers';
import { RELEASE_MAX_ITEMS, RELEASE_TYPES } from '@/lib/labelos/releases';
import { CURSOR_RE } from '@/lib/labelos/activity-feed';
import { SONG_STAGES } from '@/lib/labelos/song-stage';

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

// DELETE /api/upload/image — discard an uploaded cover nothing references.
export const UploadedImageDeleteBodySchema = z.object({
  url: z.string().min(1).max(2000),
}).strict();
export type UploadedImageDeleteBody = z.infer<typeof UploadedImageDeleteBodySchema>;

// PATCH /api/tracks/[id] — allow-list editable columns. Anything not
// in this schema is dropped by readBody, which prevents callers from
// writing to internal columns (user_id, id, analyze_status) or
// triggering DB-level "column does not exist" errors.
export const TrackPatchBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  type: z.enum(['beat', 'instrumental', 'song', 'remix', 'loop', 'topline']).optional(),
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
  // A song's main beat (migration 124). Any beat the producer owns; the DB
  // refuses another owner's beat and the song itself.
  beat_track_id: z.string().uuid().nullable().optional(),
}).strict();
export type TrackPatchBody = z.infer<typeof TrackPatchBodySchema>;

// PATCH /api/tracks/[id]/stem-files — rename / recategorise one stem file.
//
// The categories mirror the route's own allow-list, `topline` included: a
// topline is a recorded idea rather than a deliverable stem, and the producer
// share filters on exactly that value.
export const STEM_FILE_CATEGORIES = [
  'vocals', 'drums', 'bass', 'melody', 'fx', 'other', 'topline',
] as const;

export const StemFilePatchBodySchema = z.object({
  file_id: z.string().min(1),
  label: z.string().min(1).max(120).optional(),
  category: z.enum(STEM_FILE_CATEGORIES).optional(),
}).strict().refine(
  (b) => b.label !== undefined || b.category !== undefined,
  { message: 'Nothing to update' },
);
export type StemFilePatchBody = z.infer<typeof StemFilePatchBodySchema>;

// ── Notifications ───────────────────────────────────────────────────────

/**
 * Mark specific notifications read.
 *
 * Opening the bell used to PATCH `action=read_all`, so glancing at the panel
 * cleared every notification whether or not the producer had looked at it —
 * open it to check one thing and the rest are gone. Reading is now something
 * you do to a notification, not something that happens because a panel
 * rendered, so the route needs to take ids.
 */
export const NotificationReadBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
}).strict();
export type NotificationReadBody = z.infer<typeof NotificationReadBodySchema>;

// ── Track collaborators (migration 115) ────────────────────────────────
//
// `role` mirrors `title-metadata.ts`'s `CollaboratorRole` — kept as a plain
// string union here rather than importing that module's type, so this
// contract has no dependency on the parser. The column itself is free text
// (see the migration), a producer typing a role that isn't one of these three
// still writes fine; the enum only bounds what THIS route's POST accepts.
export const COLLABORATOR_ROLES = ['producer', 'feature', 'collaborator'] as const;

export const CollaboratorCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.enum(COLLABORATOR_ROLES),
}).strict();
export type CollaboratorCreateBody = z.infer<typeof CollaboratorCreateBodySchema>;

export const CollaboratorDeleteBodySchema = z.object({
  id: z.string().min(1),
}).strict();
export type CollaboratorDeleteBody = z.infer<typeof CollaboratorDeleteBodySchema>;

/** PATCH /api/tracks/[id]/collaborators — link a credit to a CRM contact (mig 124), or unlink with null. */
export const CollaboratorLinkBodySchema = z.object({
  id: z.string().min(1),
  contact_id: z.string().uuid().nullable(),
}).strict();
export type CollaboratorLinkBody = z.infer<typeof CollaboratorLinkBodySchema>;

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
  // Full track (default) or the 75 s preview only. Mig 121, lib/share/playback.
  full_playback: z.boolean().optional(),
});
export type ProjectShareCreateBody = z.infer<typeof ProjectShareCreateBodySchema>;

export const ProjectSharePatchBodySchema = z.object({
  allow_downloads: z.boolean().optional(),
  full_playback: z.boolean().optional(),
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

// ── Project share invites ───────────────────────────────────────────────

/**
 * POST /api/projects/[id]/shares/[shareId]/invite.
 *
 * `contact_id` asks the route to record the send in `beat_sends`. Send it only
 * when the invite is NOT part of a campaign: a campaign send is recorded by
 * `/api/campaigns/[id]/targets` instead, and sending both writes two rows.
 */
export const ProjectShareInviteBodySchema = z.object({
  email: z.string().trim().max(320).nullable().optional(),
  message: z.string().max(5000).optional().default(''),
  contact_id: z.string().uuid().nullable().optional(),
});
export type ProjectShareInviteBody = z.infer<typeof ProjectShareInviteBodySchema>;

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

// Rename a saved segment, retarget its filters, or reorder it. Every field is
// optional so a rename doesn't have to resend the filter payload; the route
// rejects a body that would change nothing.
export const ContactSegmentUpdateBodySchema = z.object({
  name: z.string().min(1).max(60).optional(),
  filters: ContactSegmentFiltersSchema.optional(),
  position: z.number().int().min(0).max(1000).optional(),
}).strict();
export type ContactSegmentUpdateBody = z.infer<typeof ContactSegmentUpdateBodySchema>;

// ── Find-or-create a contact by email (ad-hoc send) ───────────────────────
export const ContactResolveBodySchema = z.object({
  email: z.string().email().max(200),
  name: z.string().max(120).optional(),
}).strict();
export type ContactResolveBody = z.infer<typeof ContactResolveBodySchema>;

// ── CRM lifecycle stage (mig 092) ─────────────────────────────────────────
// Editable, stored. Distinct from the auto-computed activity tone.
//
// Ordered as the pipeline reads, because this array drives the dropdown.
// `customer` is terminal-positive and set automatically by the Stripe webhook
// on any completed purchase — before it existed the stage the producer
// actually manages never moved on a sale (only the parallel
// `buyer_pipeline_status` column did, which the stage cell doesn't read).
// Mig 092 enforces the allowed values in Zod rather than a CHECK constraint,
// so adding a stage needs no schema change.
export const CRM_STAGES = ['prospect', 'active', 'engaged', 'customer', 'cold', 'archived'] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

// ── Contact create / edit ─────────────────────────────────────────────────
// One field list shared by POST /api/contacts and PATCH /api/contacts/[id],
// so the two can't drift. They did: the create route hand-destructured seven
// keys and silently dropped everything else, including `phone` and `category`
// — both of which AddContactModal has always collected, and `category` drives
// the CRM filters. A hand-added contact lost them on every save.
const ContactWritableFields = {
  email: z.string().email().max(200).nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
  role: z.string().max(120).nullable().optional(),
  label: z.string().max(120).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  /** The one extra role beside `category` (mig 134, lib/contacts/roles). */
  secondary_category: z.string().max(60).nullable().optional(),
  genre: z.string().max(120).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  instagram: z.string().max(120).nullable().optional(),
  twitter: z.string().max(120).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  crm_status: z.enum(CRM_STAGES).nullable().optional(),
  /** Mig 124. A URL /api/upload/image returned: public http(s) or an app path, never a private reference. */
  avatar_url: z.string().max(500)
    .refine((v) => /^https?:\/\//.test(v) || (v.startsWith('/') && !v.startsWith('//')), { message: 'Avatar must be an uploaded image URL' })
    .nullable().optional(),
} as const;

export const ContactCreateBodySchema = z.object({
  name: z.string().min(1).max(200),
  ...ContactWritableFields,
}).strict();
export type ContactCreateBody = z.infer<typeof ContactCreateBodySchema>;

export const ContactPatchBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  ...ContactWritableFields,
}).strict();
export type ContactPatchBody = z.infer<typeof ContactPatchBodySchema>;

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
  full_playback: z.boolean().optional(),
});
export type ShareCreateBody = z.infer<typeof ShareCreateBodySchema>;

// ── Creator profile ────────────────────────────────────────────────────────
// POST/PATCH /api/profile. The form historically sent price + numeric fields
// as strings (the route parseFloat/Number-coerces), so those accept string OR
// number here. All fields optional; unknown keys are dropped (not .strict) so
// the route's existing whitelist-by-destructure stays the source of truth.
const numericLike = z.union([z.number(), z.string()]).nullish();
/**
 * A storefront layout, bounded rather than exhaustively typed.
 *
 * `passthrough` on the section object is deliberate: section settings grow, and
 * a producer's saved storefront must keep round-tripping when they do. The
 * caps are the actual protection — an unbounded sections array or an
 * unbounded string is what would let a hand-rolled request bloat a row that is
 * read on every storefront render. The DB carries a hard 256KB check too.
 */
const StoreLayoutSchema = z.object({
  version: z.number().int().min(1).max(1000),
  sections: z
    .array(
      z
        .object({
          id: z.string().min(1).max(120),
          kind: z.string().min(1).max(60),
          name: z.string().max(200).optional(),
          locked: z.boolean().optional(),
          base: z.record(z.string(), z.unknown()),
          overrides: z.record(z.string(), z.unknown()).optional(),
          content: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough(),
    )
    .max(60),
  theme: z.record(z.string(), z.unknown()),
  updatedAt: z.string().max(40).optional(),
});

export const CreatorProfilePatchSchema = z.object({
  display_name: z.string().max(200).nullish(),
  bio: z.string().max(10000).nullish(),
  hero_image_url: z.string().max(2000).nullish(),
  default_artwork_url: z.string().max(2000).nullish(),
  logo_url: z.string().max(2000).nullish(),
  default_artwork_project_url: z.string().max(2000).nullish(),
  default_artwork_playlist_url: z.string().max(2000).nullish(),
  // Array of {hex,weight} from the client-side extractor. Validated again on
  // read via normalisePalette — this only bounds the size so a hand-rolled
  // request can't push an unbounded blob into the row.
  default_artwork_palette: z
    .array(z.object({ hex: z.string().max(9), weight: z.number().optional() }))
    .max(12)
    .nullish(),
  default_artwork_project_palette: z
    .array(z.object({ hex: z.string().max(9), weight: z.number().optional() }))
    .max(12)
    .nullish(),
  default_artwork_playlist_palette: z
    .array(z.object({ hex: z.string().max(9), weight: z.number().optional() }))
    .max(12)
    .nullish(),
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
  // Without this key the object schema strips it, and the Store Editor's text
  // colour was dropped from every save (STORE-06).
  text_color_primary: z.string().max(40).nullish(),
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
  /**
   * Storefront section layout + theme.
   *
   * Structure is checked here only far enough to reject something that is not
   * a layout at all and to bound the size — the same posture as
   * `default_artwork_palette`. The real coercion happens on READ, in
   * `normalizeLayout`, which drops unknown section kinds and fills in theme
   * keys added since the document was saved. Validating exhaustively here
   * instead would mean a layout saved today stops being accepted the moment a
   * new section kind ships, which is the wrong failure for a producer's
   * existing storefront.
   */
  store_layout: StoreLayoutSchema.nullish(),
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

// ── Artist workspace (migrations 122–126) ───────────────────────────────

export const PROJECT_CONTACT_ROLES = ['artist', 'featured', 'manager', 'engineer', 'collaborator'] as const;

/** POST /api/projects/[id]/contacts — link a contact to a project. */
export const ProjectContactLinkBodySchema = z.object({
  contact_id: z.string().uuid(),
  role: z.enum(PROJECT_CONTACT_ROLES).optional().default('artist'),
  in_portal: z.boolean().optional().default(false),
  allow_downloads: z.boolean().optional().default(false),
}).strict();
export type ProjectContactLinkBody = z.infer<typeof ProjectContactLinkBodySchema>;

/** PATCH /api/projects/[id]/contacts/[contactId] — portal permissions and role. */
export const ProjectContactPatchBodySchema = z.object({
  role: z.enum(PROJECT_CONTACT_ROLES).optional(),
  in_portal: z.boolean().optional(),
  allow_downloads: z.boolean().optional(),
  can_comment: z.boolean().optional(),
  /** Mig 135: the pitch a label sees on this project in their portal. Empty clears it. */
  pitch_note: z.string().max(2000).nullable().optional(),
}).strict().refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type ProjectContactPatchBody = z.infer<typeof ProjectContactPatchBodySchema>;

/** PUT /api/contacts/[id]/decisions — the producer sets decisions on one or more beats. */
export const ContactDecisionBodySchema = z.object({
  track_ids: z.array(z.string().uuid()).min(1).max(200),
  decision: z.enum(DECISIONS).nullable(),
  project_id: z.string().uuid().nullable().optional(),
}).strict();
export type ContactDecisionBody = z.infer<typeof ContactDecisionBodySchema>;

/** POST /api/contacts/[id]/portal — create, revoke or reissue the artist's portal. */
export const ArtistPortalActionBodySchema = z.object({
  action: z.enum(['create', 'revoke', 'reissue', 'settings']),
  password: z.string().min(4).max(200).nullable().optional(),
  /** settings: hand Notify to the daily digest cron (mig 129). */
  auto_digest: z.boolean().optional(),
  /** settings: the artist must confirm their email before the portal opens (mig 131). */
  require_sign_in: z.boolean().optional(),
}).strict().refine((b) => b.action !== 'settings' || b.auto_digest !== undefined || b.require_sign_in !== undefined, { message: 'Nothing to update' });
export type ArtistPortalActionBody = z.infer<typeof ArtistPortalActionBodySchema>;

/** POST /api/contacts/[id]/notify — one digest email of what is new in the portal. */
export const ArtistNotifyBodySchema = z.object({
  message: z.string().max(2000).optional().default(''),
}).strict();
export type ArtistNotifyBody = z.infer<typeof ArtistNotifyBodySchema>;

/** POST /api/portal/[token]/reaction — the artist's Interested / Pass (null takes it back). */
export const PortalReactionBodySchema = z.object({
  track_id: z.string().uuid(),
  decision: z.enum(['interested', 'passed']).nullable(),
}).strict();
export type PortalReactionBody = z.infer<typeof PortalReactionBodySchema>;

/** POST /api/portal/[token]/play — one play, logged once per track per visit window. */
export const PortalPlayBodySchema = z.object({
  track_id: z.string().uuid(),
}).strict();
export type PortalPlayBody = z.infer<typeof PortalPlayBodySchema>;

// ── Artist workspace, phase 2 (migrations 127–129) ───────────────────────

const ASSET_KINDS = ['reference', 'artwork', 'lyrics', 'document', 'audio', 'other'] as const;

/** POST /api/projects/[id]/assets/presign — a presigned PUT for a large project file. */
export const ProjectAssetPresignBodySchema = z.object({
  file_name: z.string().min(1).max(300),
  size_bytes: z.number().int().positive(),
}).strict();
export type ProjectAssetPresignBody = z.infer<typeof ProjectAssetPresignBodySchema>;

/** POST /api/projects/[id]/assets (JSON) — register a file uploaded with a presigned PUT. */
export const ProjectAssetRegisterBodySchema = z.object({
  url: z.string().min(1).max(500),
  file_name: z.string().min(1).max(300),
  kind: z.enum(ASSET_KINDS).optional(),
  label: z.string().max(200).optional(),
  in_portal: z.boolean().optional().default(false),
}).strict();
export type ProjectAssetRegisterBody = z.infer<typeof ProjectAssetRegisterBodySchema>;

/** Fields of a multipart POST /api/projects/[id]/assets besides the file. */
export const ProjectAssetFormFieldsSchema = z.object({
  kind: z.enum(ASSET_KINDS).optional(),
  label: z.string().max(200).optional(),
  in_portal: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});

/** PATCH /api/projects/[id]/assets/[assetId] */
export const ProjectAssetPatchBodySchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(ASSET_KINDS).optional(),
  in_portal: z.boolean().optional(),
  position: z.number().int().min(0).max(100000).optional(),
}).strict().refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type ProjectAssetPatchBody = z.infer<typeof ProjectAssetPatchBodySchema>;

const commentRegion = <T extends { region_start?: number | null; region_end?: number | null }>(b: T) =>
  (b.region_start == null) === (b.region_end == null)
  && (b.region_start == null || (b.region_end as number) > (b.region_start as number));

/** POST /api/portal/[token]/comments — the artist comments on a portal project or beat. */
export const PortalCommentBodySchema = z.object({
  project_id: z.string().uuid(),
  track_id: z.string().uuid().nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  body: z.string().trim().min(1, 'Comment cannot be empty').max(5000, 'Comment too long'),
  region_start: z.number().min(0).max(86400).nullable().optional(),
  region_end: z.number().min(0).max(86400).nullable().optional(),
}).strict().refine(commentRegion, { message: 'A time range needs a start before its end' });
export type PortalCommentBody = z.infer<typeof PortalCommentBodySchema>;

/** POST /api/contacts/[id]/comments — the producer writes in an artist's portal thread. */
export const ArtistCommentBodySchema = z.object({
  project_id: z.string().uuid(),
  track_id: z.string().uuid().nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  body: z.string().trim().min(1, 'Comment cannot be empty').max(5000, 'Comment too long'),
}).strict();
export type ArtistCommentBody = z.infer<typeof ArtistCommentBodySchema>;

// ── Artist messages + requests (mig 130) ─────────────────────────────────

const messageBody = z.string().trim().min(1, 'Message cannot be empty').max(4000, 'Message too long');

/** POST /api/portal/[token]/messages — the artist writes, or asks for something. */
export const PortalMessageBodySchema = z.object({
  body: messageBody,
  kind: z.enum(['message', 'request']).optional().default('message'),
  project_id: z.string().uuid().nullable().optional(),
}).strict();
export type PortalMessageBody = z.infer<typeof PortalMessageBodySchema>;

/** POST /api/contacts/[id]/messages — the producer writes to the artist. */
export const ArtistMessageBodySchema = z.object({
  body: messageBody,
  /** false keeps the message in the portal only (no email fallback). */
  email: z.boolean().optional().default(true),
}).strict();
export type ArtistMessageBody = z.infer<typeof ArtistMessageBodySchema>;

/** PATCH /api/contacts/[id]/messages/[messageId] — the producer moves a request. */
export const ArtistRequestPatchBodySchema = z.object({
  request_status: z.enum(['open', 'done', 'declined']),
}).strict();
export type ArtistRequestPatchBody = z.infer<typeof ArtistRequestPatchBodySchema>;

/** POST /api/portal/[token]/sign-in — ask for a link (no code) or redeem one. */
export const PortalSignInBodySchema = z.object({
  code: z.string().min(10).max(600).optional(),
}).strict();
export type PortalSignInBody = z.infer<typeof PortalSignInBodySchema>;

/** PUT /api/tracks/[id]/beats — the beats a song is built on, main beat first (mig 132). */
export const SongBeatsBodySchema = z.object({
  beat_ids: z.array(z.string().uuid()).max(12, 'A song can be built on at most 12 beats'),
}).strict().refine((b) => new Set(b.beat_ids).size === b.beat_ids.length, { message: 'A beat is listed twice' });
export type SongBeatsBody = z.infer<typeof SongBeatsBodySchema>;

// ── Linked material (migs 132 + 133) ─────────────────────────────────────

/**
 * POST / DELETE /api/tracks/[id]/links — link another track to this one.
 * `direction: 'out'` (default) reads "track_id is this track's <relation>"
 * (this song's beat, this beat's loop); 'in' reads the other way round.
 */
export const TrackLinkBodySchema = z.object({
  track_id: z.string().uuid(),
  relation: z.enum(['beat', 'instrumental', 'loop', 'topline', 'version']),
  direction: z.enum(['out', 'in']).optional().default('out'),
}).strict();
export type TrackLinkBody = z.infer<typeof TrackLinkBodySchema>;
/**
 * DELETE /api/tracks/[id]/links. Also takes the Label OS relations (mig 140),
 * so a master or demo link the drawer shows can always be removed; creating
 * one (POST, TrackLinkBodySchema) stays refused on the producer route.
 */
export const TrackUnlinkBodySchema = z.object({
  track_id: z.string().uuid(),
  relation: z.enum(['beat', 'instrumental', 'loop', 'topline', 'version', 'master', 'demo']),
  direction: z.enum(['out', 'in']).optional().default('out'),
}).strict();

// ── Label OS invitations (LABEL-08) ──────────────────────────────────────

/**
 * POST /api/org/[orgId]/invitations. Which roles and functions are allowed is
 * decided per org kind by `validateInvitationGrant` (lib/labelos/invitations),
 * so here they are only bounded strings. `contact_ids` are the roster artists
 * (contacts, 17 R3) the member is limited to; the route checks they are on
 * that org's roster.
 */
export const OrgInvitationCreateBodySchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(200),
  role: z.string().min(1).max(40),
  functions: z.array(z.string().min(1).max(40)).max(9).optional().default([]),
  contact_ids: z.array(z.string().uuid()).max(100).optional().default([]),
}).strict();
export type OrgInvitationCreateBody = z.infer<typeof OrgInvitationCreateBodySchema>;

/**
 * POST /api/org/join. The token travels in the body, never an API query
 * string (the join PAGE's own URL does carry it, as share links do). `preview` reads what the invitation is
 * for (no session needed); `accept` joins (session required).
 */
export const OrgJoinBodySchema = z.object({
  token: z.string().min(1).max(200),
  action: z.enum(['preview', 'accept']).optional().default('accept'),
}).strict();
export type OrgJoinBody = z.infer<typeof OrgJoinBodySchema>;

// ── Label OS org settings + members (LABEL-09) ───────────────────────────

/** PATCH /api/org/[orgId]. The name only: the slug never changes. */
export const OrgPatchBodySchema = z.object({
  name: z.string().trim().min(1, 'Name the organization').max(80),
}).strict();
export type OrgPatchBody = z.infer<typeof OrgPatchBodySchema>;

/**
 * PATCH /api/org/[orgId]/members. Which roles, functions, scopes and
 * switches are allowed is decided per org kind and per actor by
 * `planMemberChange` (lib/labelos/members), so here they are only bounded
 * strings. At least one field besides `user_id`.
 */
export const OrgMemberPatchBodySchema = z.object({
  user_id: z.string().uuid(),
  role: z.string().min(1).max(40).optional(),
  functions: z.array(z.string().min(1).max(40)).max(9).optional(),
  scope: z.string().min(1).max(20).optional(),
  cap_grants: z.array(z.string().min(1).max(60)).max(40).optional(),
  cap_revokes: z.array(z.string().min(1).max(60)).max(40).optional(),
}).strict().refine(
  (b) => b.role !== undefined || b.functions !== undefined || b.scope !== undefined || b.cap_grants !== undefined || b.cap_revokes !== undefined,
  { message: 'Nothing to change' },
);
export type OrgMemberPatchBody = z.infer<typeof OrgMemberPatchBodySchema>;

// ── Label OS external project members (LABEL-21) ─────────────────────────

/**
 * POST /api/org/[orgId]/projects/[id]/members — invite a person with their
 * own account to ONE project. The role is one of the four external project
 * roles (06 §2.6), checked by `validateProjectInvite` (lib/labelos/project-
 * members); here only bounded. `allow_downloads` is what a viewer or
 * commenter may do with masters; a contributor or editor always may.
 */
export const OrgProjectInviteBodySchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(200),
  role: z.string().min(1).max(40),
  allow_downloads: z.boolean().optional().default(false),
}).strict();
export type OrgProjectInviteBody = z.infer<typeof OrgProjectInviteBodySchema>;

/** PATCH /api/org/[orgId]/projects/[id]/members/[userId]. At least one field; `expires_at: null` clears the expiry. */
export const OrgProjectMemberPatchBodySchema = z.object({
  role: z.string().min(1).max(40).optional(),
  allow_downloads: z.boolean().optional(),
  expires_at: z.string().max(40).nullable().optional(),
}).strict().refine(
  (b) => b.role !== undefined || b.allow_downloads !== undefined || b.expires_at !== undefined,
  { message: 'Nothing to change' },
);
export type OrgProjectMemberPatchBody = z.infer<typeof OrgProjectMemberPatchBodySchema>;

// ── Label OS org contacts + artist scope (LABEL-10) ──────────────────────

/**
 * POST / PATCH /api/org/[orgId]/contacts[/id]: an org's own people directory
 * (17 R3, Q2). The producer's field list, so the two cannot drift — minus
 * `notes` and `crm_status`, the CRM's private fields: an org contact is read
 * by every member in scope, including the roster artist it describes (role
 * `artist`, D5), so it must not hold business-internal notes. `org_id` and
 * `user_id` are never accepted from the body.
 */
const ORG_CONTACT_PRIVATE = { notes: true, crm_status: true } as const;
export const OrgContactCreateBodySchema = ContactCreateBodySchema.omit(ORG_CONTACT_PRIVATE);
export type OrgContactCreateBody = z.infer<typeof OrgContactCreateBodySchema>;
export const OrgContactPatchBodySchema = ContactPatchBodySchema.omit(ORG_CONTACT_PRIVATE).refine(
  (b) => Object.keys(b).length > 0,
  { message: 'Nothing to change' },
);
export type OrgContactPatchBody = z.infer<typeof OrgContactPatchBodySchema>;

/**
 * PUT /api/org/[orgId]/members/artists: the roster contacts an
 * artists-scoped member sees (member_artist_scopes), replaced as a whole.
 * An empty list is allowed and means "sees nothing". At most 150: past that
 * a member should see the whole org, and the list must fit in the audit
 * event (16 KB) and in a PostgREST `in.(…)` filter.
 */
export const ORG_MEMBER_ARTISTS_MAX = 150;
export const OrgMemberArtistsBodySchema = z.object({
  user_id: z.string().uuid(),
  contact_ids: z.array(z.string().uuid()).max(ORG_MEMBER_ARTISTS_MAX),
}).strict();
export type OrgMemberArtistsBody = z.infer<typeof OrgMemberArtistsBodySchema>;

// ── Label OS org audio (LABEL-13) ────────────────────────────────────────

/**
 * GET /api/org/[orgId]/audio/[trackId] query. The track is the path; the
 * query only names WHICH of its stored files (`variant`, parsed by
 * `parseOrgAudioVariant` in lib/labelos/org-audio) and whether to download.
 * `src` / `key` (what `/api/audio` takes) are refused outright: the route
 * never takes a URL or an `r2://` reference from the client. Any other
 * parameter (a player's cache-buster) is ignored.
 */
export const OrgAudioQuerySchema = z.object({
  variant: z.string().max(40).optional(),
  download: z.enum(['0', '1']).optional(),
  src: z.undefined({ message: 'Name a track, not a file' }).optional(),
  key: z.undefined({ message: 'Name a track, not a file' }).optional(),
});
export type OrgAudioQuery = z.infer<typeof OrgAudioQuerySchema>;

// ── Label OS activity feeds (LABEL-20) ───────────────────────────────────

/** Newest events per page of a feed, and the most one page may ask for. */
export const ORG_ACTIVITY_DEFAULT_LIMIT = 100;
export const ORG_ACTIVITY_MAX_LIMIT = 200;

/**
 * GET /api/org/[orgId]/activity query. At most one of `artist` / `project` /
 * `song` picks the feed (none = the org overview feed). `since` keeps events
 * after an instant (the overview's "since your last visit"), `before` is the
 * previous page's `nextBefore` — a `<created_at>_<id>` position, so events
 * written in one transaction are never split by a page boundary. Instants are
 * ISO with an offset; anything else is a 400, never a silent default. Empty
 * values (`?before=`) are read as absent.
 */
export const OrgActivityQuerySchema = z
  .object({
    artist: z.string().uuid().optional(),
    project: z.string().uuid().optional(),
    song: z.string().uuid().optional(),
    since: z.string().datetime({ offset: true }).optional(),
    before: z.string().regex(CURSOR_RE, { message: 'before must be a cursor from a previous page' }).optional(),
    limit: z.coerce.number().int().min(1).max(ORG_ACTIVITY_MAX_LIMIT).default(ORG_ACTIVITY_DEFAULT_LIMIT),
  })
  .refine((q) => [q.artist, q.project, q.song].filter(Boolean).length <= 1, { message: 'Ask for one of artist, project or song' });
export type OrgActivityQuery = z.infer<typeof OrgActivityQuerySchema>;

/**
 * POST /api/org/[orgId]/overview/seen: the member has looked at the digest up
 * to `through` (the `asOf` the digest was served with — not "now", or an
 * event written while the page was open would be marked seen unseen). The
 * user is always the session's; the body names no one.
 */
export const OrgOverviewSeenBodySchema = z.object({ through: z.string().datetime({ offset: true }) }).strict();
export type OrgOverviewSeenBody = z.infer<typeof OrgOverviewSeenBodySchema>;

// ── Label OS org upload (LABEL-14) ───────────────────────────────────────

/**
 * What an org upload becomes (lib/labelos/org-upload): a new song for a
 * roster artist, or material linked to an existing org song. Sent at init
 * (checked before a byte moves) and again at complete (checked again — the
 * session row stores no intent, and access may have changed meanwhile).
 */
export const OrgUploadIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('song'), contactId: z.string().uuid() }),
  z.object({ kind: z.literal('link'), songId: z.string().uuid(), relation: z.enum(ORG_UPLOAD_RELATIONS) }),
]);
export type OrgUploadIntentBody = z.infer<typeof OrgUploadIntentSchema>;

/**
 * POST /api/org/[orgId]/upload/init. Unlike the producer route it takes no
 * `projectId`, `replaceTrackId` or `trackType`: the destination and the type
 * follow from the intent, and are decided by the server. Unknown keys drop.
 */
export const OrgUploadInitSchema = z.object({
  fileName: z.string().trim().min(1).max(300),
  fileSize: z.number().int().positive(),
  fileType: z.string().max(120).optional(),
  as: OrgUploadIntentSchema,
});

/** POST /api/org/[orgId]/upload/complete. `analysis` is validated per field by `parseClientAnalysis`. */
export const OrgUploadCompleteSchema = z.object({
  sessionId: z.string().min(1).max(64),
  analysis: z.unknown().optional(),
  as: OrgUploadIntentSchema,
});

/** POST /api/org/[orgId]/upload/abort. */
export const OrgUploadSessionSchema = z.object({ sessionId: z.string().min(1).max(64) });

// ── Label OS org files (LABEL-15) ────────────────────────────────────────
// The presign body is the producer's (ProjectAssetPresignBodySchema). None of
// these takes `in_portal`: org files are not in any portal (the portal is
// producer-owned until a later task), and a restricted file never may be.

/** POST /api/org/[orgId]/projects/[id]/assets (JSON) — register a presigned upload. */
export const OrgAssetRegisterBodySchema = z.object({
  url: z.string().min(1).max(500),
  file_name: z.string().min(1).max(300),
  kind: z.enum(ORG_ASSET_KINDS).optional(),
  label: z.string().max(200).optional(),
  sensitivity: z.enum(ASSET_SENSITIVITIES).optional(),
}).strict();
export type OrgAssetRegisterBody = z.infer<typeof OrgAssetRegisterBodySchema>;

/** Fields of a multipart POST /api/org/[orgId]/projects/[id]/assets besides the file. */
export const OrgAssetFormFieldsSchema = z.object({
  kind: z.enum(ORG_ASSET_KINDS).optional(),
  label: z.string().max(200).optional(),
  sensitivity: z.enum(ASSET_SENSITIVITIES).optional(),
});

/** PATCH /api/org/[orgId]/projects/[id]/assets/[assetId] */
export const OrgAssetPatchBodySchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(ORG_ASSET_KINDS).optional(),
  sensitivity: z.enum(ASSET_SENSITIVITIES).optional(),
  position: z.number().int().min(0).max(100000).optional(),
}).strict().refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type OrgAssetPatchBody = z.infer<typeof OrgAssetPatchBodySchema>;

// ── Label OS org comments (LABEL-22) ─────────────────────────────────────
// None of these takes an org, project, user, author or resolver: the org and
// project are the path, the author is the session, `resolved_by` is the
// caller. `visibility` is `artist` (default) or `internal`; the route refuses
// `internal` for anyone who is not on the team.

const COMMENT_UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Not a valid id');

/** POST /api/org/[orgId]/projects/[id]/comments */
export const OrgCommentCreateBodySchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(5000, 'Comment too long'),
  track_id: COMMENT_UUID.nullish(),
  parent_id: COMMENT_UUID.nullish(),
  visibility: z.enum(['artist', 'internal']).optional(),
  // A moment in the recording. Both or neither; the route drops a half-set pin.
  region_start: z.number().finite().nonnegative().nullish(),
  region_end: z.number().finite().positive().nullish(),
}).strict();
export type OrgCommentCreateBody = z.infer<typeof OrgCommentCreateBodySchema>;

/** PATCH /api/org/[orgId]/projects/[id]/comments/[commentId] — words, who reads it, or resolve / reopen the thread. */
export const OrgCommentPatchBodySchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(5000, 'Comment too long').optional(),
  visibility: z.enum(['artist', 'internal']).optional(),
  resolved: z.boolean().optional(),
}).strict().refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type OrgCommentPatchBody = z.infer<typeof OrgCommentPatchBodySchema>;

// ── Label OS releases (LABEL-16) ─────────────────────────────────────────
// None of these takes `org_id`, a `user_id` or a gate / delivery / store
// field: the org is the path, gates are LABEL-32, delivery LABEL-33 and the
// store LABEL-42. `state` moves only between draft and cancelled here.

/**
 * An industry code field (lib/labelos/identifiers): normalised on the way
 * in, blank → null, and an invalid code is a 400 whose message names the
 * field ("upc: not a valid UPC/EAN …") at that path.
 */
export function identifierField(kind: IdentifierKind) {
  return z
    .string()
    .max(40)
    .nullable()
    .transform((raw, ctx) => {
      if (raw === null || raw.trim() === '') return null;
      const parsed = parseIdentifier(kind, raw);
      if (!parsed.ok) {
        ctx.addIssue({ code: 'custom', message: parsed.error });
        return z.NEVER;
      }
      return parsed.value;
    });
}

/** Free text, trimmed; blank → null. */
const releaseText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === null || v === '' ? null : v));

/** A calendar date (YYYY-MM-DD) that exists; null clears it. */
const releaseDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Not a calendar date')
  .nullable();

const releaseFields = {
  title: z.string().trim().min(1, 'Name the release').max(300),
  type: z.enum(RELEASE_TYPES),
  upc: identifierField('upc'),
  label_name: releaseText(200),
  c_line: releaseText(200),
  p_line: releaseText(200),
  primary_genre: releaseText(80),
  target_date: releaseDate,
  release_date: releaseDate,
  artwork_asset_id: z.string().uuid().nullable(),
};

/** POST /api/org/[orgId]/releases. No `project_id` → the route creates the release's project. */
export const OrgReleaseCreateBodySchema = z.object({
  title: releaseFields.title,
  contact_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  type: releaseFields.type.optional(),
  upc: releaseFields.upc.optional(),
  label_name: releaseFields.label_name.optional(),
  c_line: releaseFields.c_line.optional(),
  p_line: releaseFields.p_line.optional(),
  primary_genre: releaseFields.primary_genre.optional(),
  target_date: releaseFields.target_date.optional(),
  release_date: releaseFields.release_date.optional(),
  artwork_asset_id: releaseFields.artwork_asset_id.optional(),
}).strict();
export type OrgReleaseCreateBody = z.infer<typeof OrgReleaseCreateBodySchema>;

/** PATCH /api/org/[orgId]/releases/[releaseId]. The project and the artist are fixed. */
export const OrgReleasePatchBodySchema = z.object({
  title: releaseFields.title.optional(),
  type: releaseFields.type.optional(),
  upc: releaseFields.upc.optional(),
  label_name: releaseFields.label_name.optional(),
  c_line: releaseFields.c_line.optional(),
  p_line: releaseFields.p_line.optional(),
  primary_genre: releaseFields.primary_genre.optional(),
  target_date: releaseFields.target_date.optional(),
  release_date: releaseFields.release_date.optional(),
  artwork_asset_id: releaseFields.artwork_asset_id.optional(),
  state: z.enum(['draft', 'cancelled']).optional(),
}).strict().refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type OrgReleasePatchBody = z.infer<typeof OrgReleasePatchBodySchema>;

/**
 * POST /api/org/[orgId]/tracks/[id]/stage (LABEL-24). `to` is a stored stage
 * (`released` is derived and is not accepted). `from` is the stage the caller
 * was looking at: when it is no longer the song's stage the move is a 409,
 * so a stale screen never overwrites someone else's decision.
 */
export const OrgSongStageBodySchema = z.object({
  to: z.enum(SONG_STAGES),
  from: z.enum(SONG_STAGES).optional(),
}).strict();
export type OrgSongStageBody = z.infer<typeof OrgSongStageBodySchema>;

/** POST /api/org/[orgId]/releases/[releaseId]/items — appended at the end. No master = the song itself. */
export const OrgReleaseItemCreateBodySchema = z.object({
  song_track_id: z.string().uuid(),
  master_track_id: z.string().uuid().optional(),
  version_title: releaseText(200).optional(),
  explicit: z.boolean().optional(),
}).strict();
export type OrgReleaseItemCreateBody = z.infer<typeof OrgReleaseItemCreateBodySchema>;

/** PATCH /api/org/[orgId]/releases/[releaseId]/items — the whole tracklist, in its new order. */
export const OrgReleaseItemsReorderBodySchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(RELEASE_MAX_ITEMS),
}).strict();
export type OrgReleaseItemsReorderBody = z.infer<typeof OrgReleaseItemsReorderBodySchema>;

/** PATCH /api/org/[orgId]/releases/[releaseId]/items/[itemId]. The song is fixed; remove and add to change it. */
export const OrgReleaseItemPatchBodySchema = z.object({
  master_track_id: z.string().uuid().optional(),
  version_title: releaseText(200).optional(),
  explicit: z.boolean().optional(),
}).strict().refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type OrgReleaseItemPatchBody = z.infer<typeof OrgReleaseItemPatchBodySchema>;
