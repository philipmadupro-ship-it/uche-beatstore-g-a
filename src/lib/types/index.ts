export type TrackType = 'beat' | 'instrumental' | 'song' | 'remix';
export type TrackStatus = 'finished' | 'needs_work' | 'archived' | 'maq';
export type StemsStatus = 'none' | 'pending' | 'done' | 'failed';

export interface Track {
  id: string;
  user_id: string;
  title: string;
  type: TrackType;
  audio_url: string;
  /** URL of the precomputed waveform peaks sidecar (JSON). Optional —
   *  older tracks may not have it; WavePlayer falls back to client decode. */
  peaks_url?: string | null;
  cover_url?: string | null;
  duration_seconds: number | null;
  bpm: number | null;
  key?: string | null;
  scale?: string | null;
  loudness?: number | null;
  danceability?: number | null;
  energy?: number | null;
  valence?: number | null;
  acousticness?: number | null;
  rating?: number | null; // 1-5
  status?: TrackStatus | null;
  /** Instrumental (no vocals) flag — distinct from `type` (migration 079). */
  instrumental?: boolean | null;
  stems_status: StemsStatus;
  notes?: string | null;
  lyrics?: string | null;
  lyrics_updated_at?: string | null;
  lyrics_history?: Array<{ at: string; content: string }> | null;
  // Per-track listing fields (migration 021). NULL on each price
  // = inherit the producer's profile-level default.
  description?: string | null;
  lease_price_usd?: number | null;
  exclusive_price_usd?: number | null;
  store_listed?: boolean | null;
  /** An exclusive license has sold — the storefront shows an "Exclusive Sold"
   *  badge and hides buy options (mig 075). Cleared on refund or manual re-list. */
  exclusive_sold?: boolean | null;
  free_download_enabled?: boolean | null;
  /** Store display position. Lower = appears earlier. NULL = unordered (shown after all ordered tracks). */
  store_sort_order?: number | null;
  /** Optional separate WAV upload for licensed delivery (migration 039). */
  wav_url?: string | null;
  /** Producer chose to overlay their voice tag on this beat's store preview (mig 072). */
  voice_tag_enabled?: boolean | null;
  /** Attached by the store API when voice_tag_enabled + the creator has a tag —
   *  the preview player overlays this audio at `voice_tag_interval` seconds. */
  voice_tag_url?: string | null;
  voice_tag_interval?: number | null;
  /** Detected chord timeline (mig 078) — ordered { time, chord } segments,
   *  e.g. [{ time: 0, chord: 'Am' }]. Rendered in TrackDetailsDrawer. */
  chords?: Array<{ time: number; chord: string }> | null;
  created_at: string;
}

export interface Playlist {
  id: string;
  user_id: string;
  name: string;
  cover_url?: string | null;
  created_at: string;
}

export interface PlaylistTrack {
  playlist_id: string;
  track_id: string;
  position: number;
}

export interface ShareLink {
  id: string;
  token: string;
  track_ids: string[];
  expires_at?: string | null;
  password_hash?: string | null;
  plays: number;
  created_at: string;
}

export interface SharePlay {
  id: string;
  link_token: string;
  track_id: string;
  ip_hash: string | null;
  played_at: string;
}

export type ContactCategory =
  | 'artist'
  | 'producer'
  | 'manager'
  | 'label'
  | 'a&r'
  | 'dj'
  | 'curator'
  | 'engineer'
  | 'press'
  | 'buyer'
  | 'other';

export interface Contact {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  label?: string | null;
  category?: ContactCategory | string | null;
  genre?: string | null;
  country?: string | null;
  city?: string | null;
  instagram?: string | null;
  twitter?: string | null;
  website?: string | null;
  notes?: string | null;
  /** Buyer pipeline stage — set when contact was created via store
   *  free-download or contact form (category = 'buyer'). */
  buyer_pipeline_status?: 'new_lead' | 'contacted' | 'negotiating' | 'purchased' | 'repeat_buyer' | null;
  created_at: string;
}

export type BeatSendStatus = 'sent' | 'opened' | 'interested' | 'negotiating' | 'placed' | 'pass';

export interface BeatSend {
  id: string;
  contact_id: string;
  track_ids: string[];
  share_token?: string | null;
  message?: string | null;
  status: BeatSendStatus;
  sent_at: string;
  // Email open tracking (mig 089). Populated by Resend webhook once connected.
  // Until then the UI shows a "pending" indicator.
  email_resend_id?: string | null;
  opened_at?: string | null;
  link_clicked_at?: string | null;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  date: string;
  end_date?: string | null;
  type?: 'release' | 'session' | 'deadline' | 'meeting';
  track_ids?: string[];
  notes?: string | null;
  color?: string | null;
  created_at: string;
}

export type TeamRole = 'owner' | 'admin' | 'collaborator';

export interface TeamMember {
  user_id: string;
  role: TeamRole;
  email?: string | null;
  name?: string | null;
  avatar_url?: string | null;
  joined_at: string;
}

export interface Invite {
  id: string;
  email: string;
  role: 'admin' | 'collaborator';
  token: string;
  invited_by?: string | null;
  expires_at: string;
  used_at?: string | null;
}

export interface TrackTag {
  track_id: string;
  tag: string;
  category?: string | null;
}

export interface Stem {
  id: string;
  track_id: string;
  job_id: string | null;
  status: 'pending' | 'processing' | 'done' | 'failed';
  vocals_url?: string | null;
  drums_url?: string | null;
  bass_url?: string | null;
  other_url?: string | null;
  created_at: string;
}

export interface RatingHistory {
  id: string;
  track_id: string;
  user_id: string;
  rating: number;
  rated_at: string;
}

// ---------- VAULT DOMAIN ----------

export type ProjectStatus = 'in_progress' | 'final' | 'archived';

export interface Project {
  id: string;
  user_id: string | null;
  name: string;
  cover_url: string | null;
  description: string | null;
  bpm_target: number | null;
  key_target: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  // Computed at read time:
  track_count?: number;
}

export type ProjectTrackRole = 'main' | 'reference' | 'stem_source' | 'alternate';

export interface ProjectTrack {
  project_id: string;
  track_id: string;
  role: ProjectTrackRole;
  position: number;
  added_at: string;
}

export interface TrackVersion {
  id: string;
  track_id: string;
  version_number: number;
  version_label: string;
  audio_url: string;
  duration_seconds: number | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  loudness: number | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

