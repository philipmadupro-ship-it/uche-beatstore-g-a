-- Behaviour checks for 205_stem_pipeline.sql (AUDIO-05), run by
-- scripts/local-db/check.sh. Every check RAISEs on failure.
-- Proven: the lifecycle columns exist with safe defaults, an old-style insert
-- (the reduced-mode shape) still works, the one-row-per-track rule holds (the
-- pipeline resets, never inserts, on retry), the status CHECK is unchanged,
-- and no signed-in user reads stems directly (service-role routes only).

\set P1 '''a2050000-0000-4000-8000-000000000001'''
\set P2 '''a2050000-0000-4000-8000-000000000002'''
\set T1 '''b2050000-0000-4000-8000-000000000001'''
\set T2 '''b2050000-0000-4000-8000-000000000002'''

INSERT INTO auth.users (id, email) VALUES (:P1, 'p1-205@local.test'), (:P2, 'p2-205@local.test');
INSERT INTO public.tracks (id, user_id, title, type, audio_url) VALUES (:T1, :P1, 'T1-205', 'beat', 'r2://p/a.wav'), (:T2, :P2, 'T2-205', 'beat', 'r2://p/b.wav');

CREATE FUNCTION public.check_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'CHECK FAILED: % — got %, want %', label, got, want;
  END IF;
END $$;
CREATE FUNCTION public.check_raises(label text, stmt text, pattern text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* pattern THEN RETURN; END IF;
    RAISE EXCEPTION 'CHECK FAILED: % — raised "%", wanted /%/', label, SQLERRM, pattern;
  END;
  RAISE EXCEPTION 'CHECK FAILED: % — statement succeeded, wanted /%/', label, pattern;
END $$;

-- Old-style insert (what the reduced mode writes) gets the defaults.
INSERT INTO public.stems (track_id, job_id, status) VALUES (:T1, 'demucs:j1', 'pending');
INSERT INTO public.stems (track_id, status) VALUES (:T2, 'pending');

SELECT public.check_eq('attempts defaults to 0', (SELECT attempts FROM public.stems WHERE track_id = :T1), 0);
SELECT public.check_eq('last_error defaults to null', (SELECT last_error FROM public.stems WHERE track_id = :T1), NULL::text);
SELECT public.check_eq('locked_at defaults to null', (SELECT locked_at FROM public.stems WHERE track_id = :T1), NULL::timestamptz);
SELECT public.check_eq('updated_at is stamped', (SELECT updated_at IS NOT NULL FROM public.stems WHERE track_id = :T1), true);

-- A retry is a reset of the one row, never a second insert.
SELECT public.check_raises('one stems row per track',
  format('INSERT INTO public.stems (track_id, status) VALUES (%L, ''pending'')', 'b2050000-0000-4000-8000-000000000001'),
  'duplicate key|unique');

-- The claim: pending -> processing is one conditional update.
UPDATE public.stems SET status = 'processing', locked_at = now() WHERE track_id = :T1 AND status = 'pending';
SELECT public.check_eq('claim took the row', (SELECT status FROM public.stems WHERE track_id = :T1), 'processing');
WITH u AS (UPDATE public.stems SET status = 'processing' WHERE track_id = :T1 AND status = 'pending' RETURNING 1)
SELECT public.check_eq('second claim finds nothing', (SELECT count(*) FROM u)::int, 0);

-- Status vocabulary is unchanged.
SELECT public.check_raises('status CHECK still enforced',
  format('UPDATE public.stems SET status = ''queued'' WHERE track_id = %L', 'b2050000-0000-4000-8000-000000000001'),
  'check constraint');
UPDATE public.stems SET status = 'failed', last_error = 'service unreachable', attempts = 3 WHERE track_id = :T1;
SELECT public.check_eq('failed keeps its error', (SELECT last_error FROM public.stems WHERE track_id = :T1), 'service unreachable');

-- stems is behind the legacy team-only policy (001): an ordinary signed-in
-- user reads nothing directly. Every access is a service-role route that has
-- verified track ownership first, and 205 does not widen that.
SELECT set_config('request.jwt.claims', json_build_object('sub', 'a2050000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, false);
SET ROLE authenticated;
SELECT public.check_eq('no direct read of stems for a signed-in user', (SELECT count(*) FROM public.stems)::int, 0);
RESET ROLE;
