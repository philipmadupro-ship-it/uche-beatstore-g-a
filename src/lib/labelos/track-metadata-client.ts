/**
 * The browser's side of the metadata editor (LABEL-53): load a track's
 * fields, save a patch, and say what happened in words the form can show.
 * Pure of React.
 */
import type { MetadataField, MetadataValues } from './track-metadata';

export type MetadataLoad = {
  trackId: string;
  kind: 'song' | 'recording';
  values: MetadataValues;
  updatedAt: string | null;
  writable: MetadataField[];
};

export type SaveResult =
  | { ok: true; values: MetadataValues; updatedAt: string | null; changed: MetadataField[] }
  | { ok: false; conflict: true; error: string; values: MetadataValues; updatedAt: string | null }
  | { ok: false; conflict: false; error: string; field?: MetadataField };

const LOAD_FAILED = 'Could not load the details.';
const SAVE_FAILED = 'Could not save the details.';

export async function fetchMetadata(orgId: string, trackId: string): Promise<{ ok: true; data: MetadataLoad } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/org/${orgId}/songs/${trackId}/metadata`, { cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as Partial<MetadataLoad> & { error?: string };
    if (!res.ok || !body.values) return { ok: false, error: body.error ?? LOAD_FAILED };
    return { ok: true, data: body as MetadataLoad };
  } catch {
    return { ok: false, error: LOAD_FAILED };
  }
}

/** `expected` is the token the form was loaded with; a 409 carries the values someone else saved. */
export async function saveMetadata(orgId: string, trackId: string, expected: string | null, patch: Partial<MetadataValues>): Promise<SaveResult> {
  try {
    const res = await fetch(`/api/org/${orgId}/songs/${trackId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expected, ...patch }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      field?: MetadataField;
      values?: MetadataValues;
      updatedAt?: string | null;
      changed?: MetadataField[];
    };
    if (res.status === 409 && body.values) {
      return { ok: false, conflict: true, error: body.error ?? SAVE_FAILED, values: body.values, updatedAt: body.updatedAt ?? null };
    }
    if (!res.ok || !body.values) return { ok: false, conflict: false, error: body.error ?? SAVE_FAILED, field: body.field };
    return { ok: true, values: body.values, updatedAt: body.updatedAt ?? null, changed: body.changed ?? [] };
  } catch {
    return { ok: false, conflict: false, error: SAVE_FAILED };
  }
}

/** The fields whose text differs from the saved values: what Save sends. Pure. */
export function diffDraft(saved: MetadataValues, draft: Record<MetadataField, string>, fields: readonly MetadataField[]): Partial<Record<MetadataField, string | number | boolean | null>> {
  const out: Partial<Record<MetadataField, string | number | boolean | null>> = {};
  for (const f of fields) {
    const text = draft[f];
    if (f === 'explicit') {
      const next = text === 'yes' ? true : text === 'no' ? false : null;
      if (next !== saved.explicit) out.explicit = next;
    } else if (f === 'bpm') {
      const trimmed = text.trim();
      const next = trimmed === '' ? null : Number(trimmed);
      if (next !== saved.bpm) out.bpm = Number.isNaN(next) ? trimmed : next;
    } else {
      const next = f === 'notes' ? (text.trim() === '' ? null : text) : text.trim() === '' ? null : text.trim();
      if (next !== (saved[f] ?? null)) out[f] = next;
    }
  }
  return out;
}

/** The saved values as the form's text. */
export function toDraft(v: MetadataValues): Record<MetadataField, string> {
  return {
    title: v.title ?? '',
    version_label: v.version_label ?? '',
    isrc: v.isrc ?? '',
    iswc: v.iswc ?? '',
    bpm: v.bpm === null ? '' : String(v.bpm),
    key: v.key ?? '',
    language: v.language ?? '',
    explicit: v.explicit === null ? 'unset' : v.explicit ? 'yes' : 'no',
    genre: v.genre ?? '',
    recorded_on: v.recorded_on ?? '',
    p_line: v.p_line ?? '',
    master_owner: v.master_owner ?? '',
    notes: v.notes ?? '',
  };
}
