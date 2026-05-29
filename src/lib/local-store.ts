import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';

const DB_PATH = path.join(process.cwd(), 'data', 'db.json');

interface DBSchema {
  tracks: any[];
  playlists: any[];
  playlist_tracks: any[];
  projects: any[];
  project_tracks: any[];
  track_versions: any[];
  share_plays: any[];
  contacts: any[];
  beat_sends: any[];
  calendar_events: any[];
  share_links: any[];
  team_members: any[];
  invites: any[];
  stems: any[];
  track_tags: any[];
  rating_history: any[];
  project_shares: any[];
  project_comments: any[];
  campaigns: any[];
  campaign_targets: any[];
  smart_playlists: any[];
}

function getEmptyDB(): DBSchema {
  return {
    tracks: [],
    playlists: [],
    playlist_tracks: [],
    projects: [],
    project_tracks: [],
    track_versions: [],
    share_plays: [],
    contacts: [],
    beat_sends: [],
    calendar_events: [],
    share_links: [],
    team_members: [],
    invites: [],
    stems: [],
    track_tags: [],
    rating_history: [],
    project_shares: [],
    project_comments: [],
    campaigns: [],
    campaign_targets: [],
    smart_playlists: [],
  };
}

function readDB(): DBSchema {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(getEmptyDB(), null, 2));
    }
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return getEmptyDB();
  }
}

function writeDB(db: DBSchema) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function getAll(table: keyof DBSchema) {
  const db = readDB();
  return db[table] || [];
}

export function getById(table: keyof DBSchema, id: string) {
  const db = readDB();
  return (db[table] || []).find((row: any) => row.id === id) || null;
}

export function insert(table: keyof DBSchema, row: any) {
  const db = readDB();
  const newRow = {
    id: nanoid(),
    created_at: new Date().toISOString(),
    ...row,
  };
  if (!db[table]) db[table] = [];
  db[table].push(newRow);
  writeDB(db);
  return newRow;
}

export function update(table: keyof DBSchema, id: string, partial: any) {
  const db = readDB();
  const arr = db[table] || [];
  const idx = arr.findIndex((row: any) => row.id === id);
  if (idx === -1) return null;
  arr[idx] = { ...arr[idx], ...partial };
  writeDB(db);
  return arr[idx];
}

export function deleteRow(table: keyof DBSchema, id: string) {
  const db = readDB();
  const arr = db[table] || [];
  db[table] = arr.filter((row: any) => row.id !== id);
  writeDB(db);
  return true;
}

export function query(table: keyof DBSchema, filter: (row: any) => boolean) {
  const db = readDB();
  return (db[table] || []).filter(filter);
}

/**
 * Check if Supabase is configured with real credentials.
 *
 * The result of this check decides whether API routes hit Supabase or fall
 * back to the JSON file at `data/db.json`. The fallback exists so a fresh
 * clone runs without any external services — useful for demos and tests, a
 * trap for anyone whose Supabase config silently failed.
 *
 * Production guard: when `ENABLE_LOCAL_STORE` is unset (or anything other than
 * `"true"`/`"1"`), missing/invalid Supabase credentials log a hard warning
 * and we still report `true` so the routes try Supabase and surface the real
 * config error instead of silently writing to a JSON file. To opt back into
 * local-store mode (offline dev, demos, e2e), set `ENABLE_LOCAL_STORE=true`.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const ok =
    url.includes('supabase.co') &&
    !url.includes('dummy') &&
    (key.startsWith('eyJ') || key.startsWith('sb_'));
  if (ok) return true;

  const localAllowed =
    process.env.ENABLE_LOCAL_STORE === 'true' ||
    process.env.ENABLE_LOCAL_STORE === '1';
  if (!localAllowed) {
    // Loud warning, then return `true` so callers actually attempt Supabase
    // and surface the real connection error rather than silently writing to
    // a JSON file the operator will never read.
    if (!warnedAboutMissingConfig) {
      console.error(
        '[antigravity] Supabase credentials missing or malformed. ' +
          'Local-store fallback is disabled in production. ' +
          'Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or ' +
          'ENABLE_LOCAL_STORE=true to opt into the JSON fallback.',
      );
      warnedAboutMissingConfig = true;
    }
    return true;
  }
  return false;
}

let warnedAboutMissingConfig = false;

/** Check if R2 storage is configured with real credentials */
export function isR2Configured(): boolean {
  const accountId = process.env.R2_ACCOUNT_ID || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
  const secretKey = process.env.R2_SECRET_ACCESS_KEY || '';
  const bucket = process.env.R2_BUCKET_NAME || '';
  return (
    accountId.length > 10 &&
    accountId !== 'dummy' &&
    accessKeyId !== 'dummy' &&
    accessKeyId.length > 10 &&
    secretKey.length > 10 &&
    secretKey !== 'dummy' &&
    bucket.length > 0 &&
    bucket !== 'antigravity' // 'antigravity' was the old placeholder
  );
}
