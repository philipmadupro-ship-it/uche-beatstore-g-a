-- Initial schema for Antigravity

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tracks table
CREATE TABLE IF NOT EXISTS public.tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('beat', 'instrumental', 'song', 'remix')),
    audio_url TEXT NOT NULL,
    cover_url TEXT,
    duration_seconds INTEGER,
    bpm INTEGER,
    key TEXT,
    scale TEXT,
    loudness NUMERIC,
    danceability NUMERIC,
    energy NUMERIC,
    valence NUMERIC,
    acousticness NUMERIC,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    stems_status TEXT DEFAULT 'none' CHECK (stems_status IN ('none', 'pending', 'done', 'failed')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Index for user tracks
CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON public.tracks(user_id);

-- Playlists table
CREATE TABLE IF NOT EXISTS public.playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    cover_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Playlist tracks junction table
CREATE TABLE IF NOT EXISTS public.playlist_tracks (
    playlist_id UUID REFERENCES public.playlists(id) ON DELETE CASCADE NOT NULL,
    track_id UUID REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
);

-- Share links table
CREATE TABLE IF NOT EXISTS public.share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT UNIQUE NOT NULL,
    track_ids UUID[] NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    password_hash TEXT,
    plays INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Share plays tracking table
CREATE TABLE IF NOT EXISTS public.share_plays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    link_token TEXT REFERENCES public.share_links(token) ON DELETE CASCADE NOT NULL,
    track_id UUID REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
    ip_hash TEXT,
    played_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Contacts table (CRM)
CREATE TABLE IF NOT EXISTS public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT,
    role TEXT,
    label TEXT,
    instagram TEXT,
    twitter TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Beat sends tracking (CRM activity)
CREATE TABLE IF NOT EXISTS public.beat_sends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE NOT NULL,
    track_ids UUID[] NOT NULL,
    share_token TEXT,
    message TEXT,
    status TEXT CHECK (status IN ('sent', 'opened', 'interested', 'negotiating', 'placed', 'pass')),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Calendar events table
CREATE TABLE IF NOT EXISTS public.calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE,
    type TEXT CHECK (type IN ('release', 'session', 'deadline', 'meeting')),
    track_ids UUID[],
    notes TEXT,
    color TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Invites table
CREATE TABLE IF NOT EXISTS public.invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    role TEXT CHECK (role IN ('admin', 'collaborator')),
    token TEXT UNIQUE NOT NULL,
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Team members table
CREATE TABLE IF NOT EXISTS public.team_members (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('owner', 'admin', 'collaborator')),
    email TEXT,
    name TEXT,
    avatar_url TEXT,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Track tags table
CREATE TABLE IF NOT EXISTS public.track_tags (
    track_id UUID REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
    tag TEXT NOT NULL,
    category TEXT,
    PRIMARY KEY (track_id, tag)
);

-- Stems table
CREATE TABLE IF NOT EXISTS public.stems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id UUID REFERENCES public.tracks(id) ON DELETE CASCADE UNIQUE NOT NULL,
    job_id TEXT,
    status TEXT CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    vocals_url TEXT,
    drums_url TEXT,
    bass_url TEXT,
    other_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Rating history table
CREATE TABLE IF NOT EXISTS public.rating_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id UUID REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    rated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS on all tables
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_plays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beat_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.track_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rating_history ENABLE ROW LEVEL SECURITY;

-- Reusable Policy: team members only
-- We'll define a function to check if the current user is a team member
CREATE OR REPLACE FUNCTION public.is_team_member()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.team_members WHERE user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply "team only" policy to the tables created above.
--
-- This originally queried information_schema.tables live, which silently
-- re-scopes to whatever tables exist in `public` at the moment this file
-- runs. On a fresh database that's exactly the 11 tables above; replayed
-- against an already-fully-migrated database (this file is idempotent and
-- meant to be safely re-runnable) it's ~100 unrelated tables added by every
-- migration since, each already covered by its own later, usually
-- owner-scoped policy — creating "team only" on those too would be a silent,
-- unreviewed RLS broadening, not a fix. Pinned to the fixed list instead, so
-- a full replay is idempotent and behaviourally identical to the first run.
-- (share_links / share_plays are handled separately below — they also need
-- public access.)
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'tracks', 'playlists', 'playlist_tracks', 'contacts', 'beat_sends',
        'calendar_events', 'invites', 'team_members', 'track_tags', 'stems',
        'rating_history'
    ])
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = t AND policyname = 'team only'
        ) THEN
            EXECUTE format('CREATE POLICY "team only" ON public.%I FOR ALL USING (public.is_team_member())', t);
        END IF;
    END LOOP;
END $$;

-- Special Policies for Share Links (Public Read)
DROP POLICY IF EXISTS "team only" ON public.share_links;
CREATE POLICY "team only" ON public.share_links FOR ALL USING (public.is_team_member());
DROP POLICY IF EXISTS "public read session" ON public.share_links;
CREATE POLICY "public read session" ON public.share_links FOR SELECT USING (true); -- Public can read link info if they have token (further filtering in app)

DROP POLICY IF EXISTS "team only" ON public.share_plays;
CREATE POLICY "team only" ON public.share_plays FOR ALL USING (public.is_team_member());
DROP POLICY IF EXISTS "public insert play" ON public.share_plays;
CREATE POLICY "public insert play" ON public.share_plays FOR INSERT WITH CHECK (true); -- Public can log plays

