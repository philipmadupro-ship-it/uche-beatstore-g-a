/**
 * DAW project files as pure rules (AUDIO-02): which extensions are a session,
 * which app wrote it, whether the first bytes agree with the extension, and
 * whether a .zip is a bundled session.
 *
 * A DAW file is NOT a new stored kind. `project_assets.kind` is a DB CHECK
 * (mig 127) and a session is stored as `other`; what it is gets DERIVED from
 * the file name (and, for a zip, its first entry), the same way AUDIO-01
 * derives an offline state. Nothing here reads inside a project file beyond
 * the signature; metadata is `daw-meta.ts`.
 */

export type DawApp = 'fl_studio' | 'ableton' | 'reaper' | 'pro_tools' | 'cubase' | 'logic' | 'garageband';

export const DAW_APP_LABEL: Record<DawApp, string> = {
  fl_studio: 'FL Studio',
  ableton: 'Ableton Live',
  reaper: 'Reaper',
  pro_tools: 'Pro Tools',
  cubase: 'Cubase',
  logic: 'Logic Pro',
  garageband: 'GarageBand',
};

/** What a producer project accepts as a DAW file. Opaque downloads: no registered MIME, so octet-stream. */
export const DAW_EXTENSIONS: Record<string, { app: DawApp; kindLabel: string }> = {
  flp: { app: 'fl_studio', kindLabel: 'FL Studio project' },
  als: { app: 'ableton', kindLabel: 'Ableton Live set' },
  rpp: { app: 'reaper', kindLabel: 'Reaper project' },
  ptx: { app: 'pro_tools', kindLabel: 'Pro Tools session' },
  cpr: { app: 'cubase', kindLabel: 'Cubase project' },
};
export const DAW_MIME = 'application/octet-stream';

export interface DawIdentity {
  app: DawApp;
  label: string;
  ext: string;
  /** A .zip whose first entry is a session (or a Logic / GarageBand package). */
  bundle: boolean;
}

function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 || dot === base.length - 1 ? '' : base.slice(dot + 1).toLowerCase();
}

/** The first entry's path in a zip, from its first local file header. Null when the bytes are not one. */
export function zipFirstEntryName(head: Uint8Array | null | undefined): string | null {
  if (!head || head.length < 30) return null;
  if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) return null;
  const nameLen = head[26] | (head[27] << 8);
  if (nameLen === 0 || 30 + nameLen > head.length) return null;
  let name = '';
  for (let i = 0; i < nameLen; i++) name += String.fromCharCode(head[30 + i]);
  return name;
}

function bundleApp(entry: string): DawApp | null {
  const lower = entry.toLowerCase();
  if (/\.logicx(\/|$)/.test(lower)) return 'logic';
  if (/\.band(\/|$)/.test(lower)) return 'garageband';
  const ext = extOf(lower.replace(/\/$/, ''));
  return DAW_EXTENSIONS[ext]?.app ?? null;
}

/**
 * What DAW a file is. By name alone for a session file; a `.zip` needs its
 * first bytes (`zipHead`) to say it holds one. Null for everything else.
 */
export function dawOf(fileName: string, zipHead?: Uint8Array | null): DawIdentity | null {
  const ext = extOf(fileName);
  const info = DAW_EXTENSIONS[ext];
  if (info) return { app: info.app, label: info.kindLabel, ext, bundle: false };
  if (ext === 'zip') {
    const entry = zipFirstEntryName(zipHead);
    const app = entry ? bundleApp(entry) : null;
    if (app) return { app, label: `Project bundle · ${DAW_APP_LABEL[app]}`, ext, bundle: true };
  }
  return null;
}

/** Bytes needed to sniff a signature or a zip's first entry name. */
export const DAW_SNIFF_BYTES = 1024;

export type DawSniff = 'ok' | 'mismatch' | 'unchecked';

/**
 * Do the first bytes agree with the extension? Only for the three formats
 * with a stable signature — FL Studio ("FLhd"), Ableton (a gzip stream) and
 * Reaper ("<REAPER_PROJECT"). Pro Tools and Cubase are 'unchecked': better to
 * say nothing than to guess and refuse a real file.
 */
export function sniffDaw(ext: string, head: Uint8Array): DawSniff {
  if (ext === 'flp') {
    return head.length >= 4 && head[0] === 0x46 && head[1] === 0x4c && head[2] === 0x68 && head[3] === 0x64 ? 'ok' : 'mismatch';
  }
  if (ext === 'als') return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b ? 'ok' : 'mismatch';
  if (ext === 'rpp') {
    let text = '';
    for (let i = 0; i < Math.min(head.length, 64); i++) text += String.fromCharCode(head[i]);
    return /^(﻿|\xEF\xBB\xBF)?\s*<REAPER_PROJECT/.test(text) ? 'ok' : 'mismatch';
  }
  return 'unchecked';
}

export function dawMismatchMessage(ext: string): string {
  const app = DAW_EXTENSIONS[ext] ? DAW_APP_LABEL[DAW_EXTENSIONS[ext].app] : 'a DAW';
  return `That file does not look like ${app} project. Check it is the original .${ext} file.`;
}

/** What the project Files row says about a file (AUDIO-02). `meta` is the lazily fetched `/meta` answer. */
export interface DawRowInfo {
  /** A session, or a zip the meta read proved is a bundled session. */
  isDaw: boolean;
  /** Replaces the stored kind label ("Other") in the row's subtitle; null = keep the stored kind. */
  kindLabel: string | null;
  /** "v21.2 · 140 BPM"; null when there is nothing to add. */
  detail: string | null;
}

export function dawRowInfo(
  fileName: string,
  meta: { app: string; appVersion: string | null; bpm: number | null } | null | undefined,
): DawRowInfo {
  const named = dawOf(fileName);
  if (named) {
    const detail = [meta?.appVersion ? `v${meta.appVersion}` : null, meta?.bpm != null ? `${meta.bpm} BPM` : null].filter(Boolean).join(' · ');
    return { isDaw: true, kindLabel: named.label, detail: detail || null };
  }
  if (extOf(fileName) === 'zip' && meta?.app) return { isDaw: true, kindLabel: `Bundled ${meta.app} project`, detail: null };
  return { isDaw: false, kindLabel: null, detail: null };
}
