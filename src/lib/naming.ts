/**
 * Naming system — "no object is ever Untitled"
 * Semantic, deterministic names across projects, tracks, stems, versions.
 */
import { getAll, isSupabaseConfigured } from '@/lib/local-store';
import { createClient } from '@/lib/supabase/server';

type NameRow = {
  name?: string | null;
};

function rowNames(rows: NameRow[] | null | undefined): string[] {
  return (rows ?? []).map((row) => row.name ?? '');
}

/** "Project 01", "Project 02" — padded to 2 digits, per-user unique */
export async function nextProjectName(userId: string | null): Promise<string> {
  let existing: string[] = [];

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const q = supabase.from('projects').select('name');
      const { data } = userId ? await q.eq('user_id', userId) : await q;
      existing = rowNames(data as NameRow[] | null);
    } catch {
      existing = [];
    }
  } else {
    existing = rowNames(getAll<NameRow>('projects'));
  }

  const nums = existing
    .map((n) => n.match(/^Project (\d+)$/i))
    .filter(Boolean)
    .map((m) => parseInt((m as RegExpMatchArray)[1], 10));

  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `Project ${String(next).padStart(2, '0')}`;
}

/** "Kick_Sample 01.wav" -> "Kick Sample 01" */
export function titleFromFilename(filename: string): string {
  const base = filename
    .replace(/\.[^/.]+$/, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base || 'Untagged Track';
}

/** "Track Name" + "vocals" -> "Track Name — Vocals" */
export function stemName(trackTitle: string, stem: string): string {
  const clean = (trackTitle ?? '').trim() || 'Track';
  const s = stem.charAt(0).toUpperCase() + stem.slice(1).toLowerCase();
  return `${clean} — ${s}`;
}

/** Given existing versions, compute next version number + label */
export function nextVersionLabel(
  versions: { version_number: number }[]
): { number: number; label: string } {
  const max = versions.length
    ? Math.max(...versions.map((v) => v.version_number))
    : 0;
  const number = max + 1;
  return { number, label: `v${number}` };
}

/** Default playlist name when none provided */
export async function nextPlaylistName(userId: string | null): Promise<string> {
  let existing: string[] = [];

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const q = supabase.from('playlists').select('name');
      const { data } = userId ? await q.eq('user_id', userId) : await q;
      existing = rowNames(data as NameRow[] | null);
    } catch {
      existing = [];
    }
  } else {
    existing = rowNames(getAll<NameRow>('playlists'));
  }

  const nums = existing
    .map((n) => n.match(/^Playlist (\d+)$/i))
    .filter(Boolean)
    .map((m) => parseInt((m as RegExpMatchArray)[1], 10));

  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `Playlist ${String(next).padStart(2, '0')}`;
}
