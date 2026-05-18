export type TrackType = 'beat' | 'instrumental' | 'song' | 'remix';
export type TrackStatus = 'finished' | 'needs_work' | 'archived';
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

