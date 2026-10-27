/**
 * /api/org/[orgId]/contracts/[contractId]/splits — a contract and the split
 * sheets it implies (LABEL-59, doc 23 §D). No table of its own: the contract
 * names its song (`track_id`) and a sheet is the song's, so everything here is
 * derived from the two on every request.
 *
 *   GET   what the contract would pre-fill per sheet kind (or why it cannot),
 *         and — for a sent or signed contract — whether the song's live sheets
 *         still say what it says (drift). Readable by whoever can read the
 *         contract (`mayReadContract`, artist scope included). Drift detail
 *         (names, both shares) needs `rights.read`; an own-line reader or a
 *         party to the contract gets only "this sheet differs from its
 *         contract" (D2). The internal note never appears.
 *   POST  `{ kind?, replace_draft? }` create or pre-fill DRAFT sheets from the
 *         contract's stated shares. Needs `contracts.write` AND `rights.write`
 *         on the song, inside the contract's artist scope. Only ever a draft:
 *         a circulated or signed sheet stays in force until a new draft is
 *         circulated. An existing draft is refused (409) unless
 *         `replace_draft` is sent, so hand-edited lines are never overwritten
 *         silently.
 *
 * Degrades like both halves: contracts (176) not applied → `schemaReady:
 * false` / 503; split sheets (155) not applied → the same.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess, requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgContractSplitsBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';
import { recordEvent } from '@/lib/labelos/activity';
import { SPLITS_NOT_READY } from '@/lib/labelos/audit-rpc';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { partyName } from '@/lib/labelos/contracts/context';
import { CONTRACTS_NOT_READY, ContractsNotReadyError, assertContractsSchema } from '@/lib/labelos/contracts-store';
import { loadContractFor } from '@/lib/labelos/contracts-route';
import { contractFacts, driftOfContract, sheetFactsOfSong } from '@/lib/labelos/contract-splits-store';
import { SKIP_MESSAGE, driftView, planDraftWrite, planPrefill, rulesFor, type KindPlan } from '@/lib/labelos/contract-splits';
import { partiesByIds } from '@/lib/labelos/credits-store';
import { SPLIT_KIND_LABEL, SPLIT_ROLE_LABEL, formatShare, type SplitKind, type SplitLineInput } from '@/lib/labelos/splits';
import { createDraft, resolveLines, saveDraft, splitEventSubject, SplitsNotReadyError } from '@/lib/labelos/splits-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.splits');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_FOUND = () => json(404, { error: 'Contract not found' });

type Params = { params: Promise<{ orgId: string; contractId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return NOT_FOUND();
  const { admin, orgId: org } = access;
  try {
    const loaded = await loadContractFor(access, contractId);
    if (!loaded) return NOT_FOUND();
    const { row, links, identities } = loaded;
    const facts = contractFacts(row, links);
    const kinds = rulesFor(row.type).map((r) => r.kind);
    const base = { schemaReady: true, applicable: kinds.length > 0, kinds: kinds.map((k) => ({ key: k, label: SPLIT_KIND_LABEL[k] })) };
    if (kinds.length === 0) return json(200, { ...base, plans: [], drift: [], canPrefill: false });

    const nameOf = (id: string) => (identities.get(id) ? partyName(identities.get(id)!) : 'Unknown party');
    const plans = planPrefill(facts).map((p) => planView(p, nameOf));

    // What the song's sheets say needs the song itself to be in this caller's reach.
    let drift: unknown[] = [];
    let canPrefill = false;
    let drafts: Record<string, boolean> = {};
    if (row.track_id) {
      const song = await requireObjectAccess({ table: 'tracks', id: row.track_id, cap: 'rights.read.own_line', orgId: org });
      if (song.ok) {
        const detail = access.role !== 'artist' && access.capabilities.has('rights.read');
        const { facts: sheetFacts } = await sheetFactsOfSong(admin, org, row.track_id);
        const found = driftOfContract(facts, sheetFacts);
        const ids = detail ? [...new Set(found.flatMap((d) => d.items.map((i) => i.partyId)))] : [];
        const parties = ids.length > 0 ? await partiesByIds(admin, org, ids) : new Map();
        drift = found.map((d) => ({ ...driftView(d, detail, (id) => parties.get(id)?.display_name ?? 'Unknown'), sheetId: d.sheetId }));
        canPrefill =
          access.capabilities.has('contracts.write') &&
          access.capabilities.has('rights.write') &&
          row.status !== 'void' &&
          scopeAllowsContact(access.artistScope, row.artist_contact_id);
        if (canPrefill) drafts = Object.fromEntries(kinds.map((k) => [k, sheetFacts.some((s) => s.kind === k && s.status === 'draft')]));
      }
    }
    return json(200, { ...base, plans, drift, canPrefill, drafts });
  } catch (err) {
    if (err instanceof ContractsNotReadyError || err instanceof SplitsNotReadyError) return json(200, { schemaReady: false, applicable: false, kinds: [], plans: [], drift: [], canPrefill: false });
    log.error('contract splits read failed', { orgId: org, contractId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the contract’s split sheets' });
  }
}

function planView(p: KindPlan, nameOf: (id: string) => string) {
  if (!p.ok) return { kind: p.kind, ok: false, reason: p.reason, message: SKIP_MESSAGE[p.reason] };
  return {
    kind: p.kind,
    ok: true,
    incomplete: p.incomplete,
    lines: p.lines.map((l) => ({ partyId: l.partyId, name: nameOf(l.partyId), role: l.role, roleLabel: SPLIT_ROLE_LABEL[l.role], share: formatShare(l.units) })),
  };
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.write');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return NOT_FOUND();
  const parsed = await readBody(req, OrgContractSplitsBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const { admin, orgId: org } = access;

  try {
    await assertContractsSchema(admin);
    const loaded = await loadContractFor(access, contractId);
    if (!loaded || !scopeAllowsContact(access.artistScope, loaded.row.artist_contact_id)) return NOT_FOUND();
    const { row, links } = loaded;
    if (row.status === 'void') return json(409, { error: 'A void contract cannot start a split sheet' });
    if (!row.track_id) return json(422, { error: SKIP_MESSAGE.no_song, reason: 'no_song' });
    // The song is the one the sheet belongs to: rights.write on it, inside this member's artist scope.
    const song = await requireObjectAccess({ table: 'tracks', id: row.track_id, cap: 'rights.write', orgId: org });
    if (!song.ok) return song.res;

    const facts = contractFacts(row, links);
    if (rulesFor(row.type).length === 0) return json(422, { error: 'This kind of contract does not state a split', reason: 'not_applicable' });
    const wanted = planPrefill(facts).filter((p) => !body.kind || p.kind === body.kind);
    if (wanted.length === 0) return json(422, { error: 'This contract has no split of that kind', reason: 'not_applicable' });
    const usable = wanted.filter((p): p is Extract<KindPlan, { ok: true }> => p.ok);
    if (usable.length === 0) {
      const first = wanted[0] as Extract<KindPlan, { ok: false }>;
      return json(422, { error: SKIP_MESSAGE[first.reason], reason: first.reason, results: wanted.map((p) => ({ kind: p.kind, action: 'skipped', reason: p.ok ? undefined : p.reason })) });
    }

    const existing = await sheetFactsOfSong(admin, org, row.track_id);
    // Every set of lines is checked before the first write, so a bad party cannot leave one kind written and the other not.
    const lineSets = new Map<SplitKind, { ok: true; lines: SplitLineInput[] }>();
    for (const p of usable) {
      const resolved = await resolveLines(
        admin,
        org,
        p.kind,
        p.lines.map((l) => ({ party_id: l.partyId, role: l.role, share: formatShare(l.units) })),
      );
      if (!resolved.ok) return json(resolved.status, { error: resolved.error });
      lineSets.set(p.kind, resolved);
    }
    const results: { kind: SplitKind; action: 'created' | 'replaced' | 'skipped'; reason?: string; sheetId?: string }[] = [];
    for (const p of wanted) {
      if (!p.ok) {
        results.push({ kind: p.kind, action: 'skipped', reason: p.reason });
        continue;
      }
      const decision = planDraftWrite(existing.sheets, p.kind, body.replace_draft === true);
      if (decision.action === 'refuse') {
        results.push({ kind: p.kind, action: 'skipped', reason: decision.reason });
        continue;
      }
      const resolved = lineSets.get(p.kind)!;

      if (decision.action === 'create') {
        const made = await createDraft(admin, { org, actor: access.userId, trackId: row.track_id, kind: p.kind, note: null, lines: resolved.lines, copyFrom: null });
        if ('error' in made) {
          results.push({ kind: p.kind, action: 'skipped', reason: made.error === 'draft_exists' ? 'draft_exists' : 'not_found' });
          continue;
        }
        await recordEvent(admin, { orgId: org, userId: access.userId }, 'split_sheet.created', await splitEventSubject(admin, org, row.track_id, made.sheet.id), {
          kind: p.kind,
          version: made.sheet.version,
          source: 'contract',
        });
        results.push({ kind: p.kind, action: 'created', sheetId: made.sheet.id });
      } else {
        const draft = existing.sheets.find((s) => s.kind === p.kind && s.status === 'draft')!;
        const saved = await saveDraft(admin, { org, sheetId: draft.id, lines: resolved.lines });
        if ('error' in saved) {
          results.push({ kind: p.kind, action: 'skipped', reason: saved.error });
          continue;
        }
        await recordEvent(admin, { orgId: org, userId: access.userId }, 'split_sheet.updated', await splitEventSubject(admin, org, row.track_id, draft.id), {
          kind: p.kind,
          version: draft.version,
          lines: true,
          note: false,
          source: 'contract',
        });
        results.push({ kind: p.kind, action: 'replaced', sheetId: draft.id });
      }
    }
    if (results.every((r) => r.action === 'skipped')) {
      const exists = results.some((r) => r.reason === 'draft_exists');
      return json(exists ? 409 : 422, {
        error: exists ? 'There is already a draft split sheet for this song. Send replace_draft to overwrite its lines.' : 'Nothing could be pre-filled from this contract',
        results,
      });
    }
    return json(200, { results });
  } catch (err) {
    if (err instanceof ContractsNotReadyError) return json(503, { error: CONTRACTS_NOT_READY });
    if (err instanceof SplitsNotReadyError) return json(503, { error: SPLITS_NOT_READY });
    log.error('contract split prefill failed', { orgId: org, contractId, error: errorMessage(err) });
    return json(500, { error: 'Could not pre-fill the split sheet' });
  }
}
