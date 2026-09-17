/**
 * Saved sections — the producer's own reusable blocks.
 *
 * You build a text block with the right spacing, width and copy, and you want
 * it again on the next storefront arrangement without rebuilding it. That is
 * all this is: a named section stored on its own, and inserted as a fresh
 * section wherever you ask for it.
 *
 * WHY A SAVED SECTION HAS NO ID. The stored record keeps everything about a
 * section EXCEPT its identity and its lock. Reusing an id would mean two
 * sections in one layout claiming the same key — the second insert would
 * shadow the first in every lookup, and `updateSection` would edit both. So
 * the id is stripped on save and minted on insert, which makes "insert twice"
 * a perfectly ordinary thing to do.
 *
 * Shares the `antigravity-store-editor` database with version history, through
 * the single opener in `db.ts`. IndexedDB versions are per-DATABASE, so two
 * modules opening the same one at different versions would make whichever the
 * producer touched first decide whether the other feature worked at all.
 */

import { createSectionId, type StoreSection } from './layout';
import {
  STORE_LIBRARY, deleteRecord, deleteRecords, getRecord, openStoreEditorDb, putRecord,
  readAllRecords,
} from './db';

/** How many saved sections to keep. Generous; these are small records. */
export const LIBRARY_LIMIT = 40;

export type SavedSection = {
  id: string;
  name: string;
  savedAt: string;
  /** The section minus its identity — see the note above. */
  section: Omit<StoreSection, 'id'>;
};

export type SavedSectionSummary = Omit<SavedSection, 'section'> & {
  kind: StoreSection['kind'];
};

/* ── Pure helpers ───────────────────────────────────────────────────────── */

export function isSavedSection(value: unknown): value is SavedSection {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SavedSection>;
  return typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.savedAt === 'string'
    && Boolean(record.section)
    && typeof record.section === 'object'
    && typeof (record.section as StoreSection).kind === 'string'
    && Boolean((record.section as StoreSection).base);
}

/**
 * Prepare a section for the library.
 *
 * Strips the id and clears the lock: a saved block arriving locked would be
 * one the producer cannot move or delete without first working out why.
 */
export function toSavedSection(section: StoreSection, name?: string, at = new Date()): SavedSection {
  const { id: _id, ...rest } = section;
  return {
    id: `lib-${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: (name ?? section.name).trim() || section.kind,
    savedAt: at.toISOString(),
    section: { ...rest, locked: false },
  };
}

/** Mint a real section from a saved one. Safe to call repeatedly. */
export function fromSavedSection(saved: SavedSection): StoreSection {
  return { ...saved.section, id: createSectionId(saved.section.kind) };
}

export function toLibrarySummary(saved: SavedSection): SavedSectionSummary {
  return {
    id: saved.id,
    name: saved.name,
    savedAt: saved.savedAt,
    kind: saved.section.kind,
  };
}

/** Newest first. */
export function sortSaved<T extends { savedAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/**
 * A name that is not already taken, so two saves of the same block are
 * distinguishable in the list rather than being two rows reading "Hero".
 */
export function uniqueLibraryName(name: string, existing: string[]): string {
  const taken = new Set(existing);
  const base = name.trim() || 'Saved section';
  if (!taken.has(base)) return base;
  // Continue an existing numeric suffix rather than stacking them: "Hero 2"
  // saved again becomes "Hero 3", not "Hero 2 2".
  const match = /^(.*?)\s+(\d+)$/.exec(base);
  const stem = match ? match[1] : base;
  let index = match ? Number(match[2]) + 1 : 2;
  while (taken.has(`${stem} ${index}`)) index += 1;
  return `${stem} ${index}`;
}

/* ── IndexedDB ──────────────────────────────────────────────────────────── */

async function readAll(db: IDBDatabase): Promise<SavedSection[]> {
  return sortSaved((await readAllRecords(db, STORE_LIBRARY)).filter(isSavedSection));
}

export async function listSavedSections(): Promise<SavedSectionSummary[]> {
  const db = await openStoreEditorDb();
  try {
    return (await readAll(db)).map(toLibrarySummary);
  } finally {
    db.close();
  }
}

export async function loadSavedSection(id: string): Promise<StoreSection | null> {
  const db = await openStoreEditorDb();
  try {
    const record = await getRecord(db, STORE_LIBRARY, id);
    return isSavedSection(record) ? fromSavedSection(record) : null;
  } finally {
    db.close();
  }
}

/** Save a section to the library. Returns the name it was stored under. */
export async function saveSection(section: StoreSection, name?: string): Promise<string> {
  const db = await openStoreEditorDb();
  try {
    const existing = await readAll(db);
    const saved = toSavedSection(section, name);
    saved.name = uniqueLibraryName(saved.name, existing.map((item) => item.name));

    await putRecord(db, STORE_LIBRARY, saved);

    // Trim the oldest past the cap, after writing — a crash mid-write can then
    // only leave more than intended, never fewer.
    const all = await readAll(db);
    const doomed = all.slice(LIBRARY_LIMIT);
    deleteRecords(db, STORE_LIBRARY, doomed.map((item) => item.id));
    return saved.name;
  } finally {
    db.close();
  }
}

export async function deleteSavedSection(id: string): Promise<void> {
  const db = await openStoreEditorDb();
  try {
    await deleteRecord(db, STORE_LIBRARY, id);
  } finally {
    db.close();
  }
}
