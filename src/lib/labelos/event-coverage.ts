/**
 * The rule behind LABEL-19's coverage test (08 §B3, 14 LABEL-19): every
 * `POST | PATCH | PUT | DELETE` handler under `src/app/api/org/**` records an
 * activity event — through `recordEvent`, through an audit RPC
 * (`auditRpc(` → lib/labelos/audit-rpc.ts, migration 146), or through the
 * invitation-accept function (138), which writes `member.joined` itself.
 *
 * Pure and source-text based on purpose: it is the guard that catches a new
 * org mutation shipped with no history, which `tsc` and a green build cannot.
 * The scan is per handler (up to the next top-level `export`), so a
 * `recordEvent` in a sibling handler or an unused helper does not count, and
 * comments are stripped first so a mention in prose does not either.
 *
 * `NO_EVENT_HANDLERS` is the explicit, reasoned list of handlers that mutate
 * nothing a feed could show. A stale entry (handler gone, or it records an
 * event now) fails the test, so the list cannot rot into a blanket exemption.
 */

export const MUTATING_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;
export type MutatingMethod = (typeof MUTATING_METHODS)[number];

/** What counts as "records an event" inside a handler body. */
export const EVENT_CALL = /\brecordEvent\s*\(|\bauditRpc\s*\(|\bACCEPT_INVITATION_RPC\b/;

export type Handler = { method: MutatingMethod; body: string };

/** Drop block and line comments (a `//` inside a URL string survives: it is not preceded by whitespace). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Every mutating handler a route file exports, with its body text. */
export function mutatingHandlers(source: string): Handler[] {
  const code = stripComments(source);
  const exportAt = [...code.matchAll(/^export\s/gm)].map((m) => m.index!);
  const out: Handler[] = [];
  const decl = /^export\s+(?:async\s+function\s+(POST|PATCH|PUT|DELETE)\b|const\s+(POST|PATCH|PUT|DELETE)\s*=)/gm;
  for (const m of code.matchAll(decl)) {
    const start = m.index!;
    const next = exportAt.find((i) => i > start) ?? code.length;
    out.push({ method: (m[1] ?? m[2]) as MutatingMethod, body: code.slice(start, next) });
  }
  return out;
}

export type CoverageFile = { path: string; source: string };

/** `path:METHOD` for every mutating handler that records no event and is not allowlisted. */
export function coverageGaps(files: CoverageFile[], allow: Readonly<Record<string, string>> = {}): string[] {
  const gaps: string[] = [];
  for (const f of files) {
    for (const h of mutatingHandlers(f.source)) {
      const key = `${f.path}:${h.method}`;
      if (!EVENT_CALL.test(h.body) && !(key in allow)) gaps.push(key);
    }
  }
  return gaps.sort();
}

/** Allowlist entries that no longer apply: the handler is gone, or it records an event now. */
export function staleAllowances(files: CoverageFile[], allow: Readonly<Record<string, string>>): string[] {
  const seen = new Map<string, boolean>();
  for (const f of files) {
    for (const h of mutatingHandlers(f.source)) seen.set(`${f.path}:${h.method}`, EVENT_CALL.test(h.body));
  }
  return Object.keys(allow)
    .filter((key) => !seen.has(key) || seen.get(key) === true)
    .sort();
}

/**
 * Handlers that change no domain object. Paths are relative to src/app/api/org.
 * Each needs a reason a reviewer can check.
 */
export const NO_EVENT_HANDLERS: Readonly<Record<string, string>> = {
  '[orgId]/projects/[id]/assets/presign/route.ts:POST':
    'Mints a presigned PUT URL for a file; nothing is stored until POST …/assets registers it, and that records file.uploaded.',
  '[orgId]/upload/init/route.ts:POST':
    'Opens a multipart upload session (storage plumbing). The song or recording exists only after …/upload/complete, which records song.created / recording.uploaded.',
  '[orgId]/upload/part/route.ts:POST':
    'Uploads one part of a multipart session (bytes only). The event is written by …/upload/complete.',
  '[orgId]/upload/part/route.ts:PATCH':
    'Same handler as POST on this route (part upload verb alias). The event is written by …/upload/complete.',
  '[orgId]/upload/part/route.ts:PUT':
    'Same handler as POST on this route (part upload verb alias). The event is written by …/upload/complete.',
  '[orgId]/upload/abort/route.ts:POST':
    'Abandons a multipart session before anything was created; there is no object to record history on.',
};
