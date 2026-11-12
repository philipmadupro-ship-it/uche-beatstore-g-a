'use client';

/**
 * The state behind a filter bar (LABEL-37): the applied definition, the saved
 * view it came from (if any), the result of running it for THIS viewer, and
 * the saved-views list. The URL is the memory — `?view=<id>` for a saved view,
 * `?f=<encoded>` for an ad-hoc one — written with `replaceState` (no
 * navigation) and read once on mount, the way the board keeps `?state=`.
 *
 * Every run is a fresh request: nothing here caches a result against a
 * definition, because the rows depend on who is asking.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  decodeDefinition,
  emptyDefinition,
  encodeDefinition,
  isEmptyFilter,
  type Definition,
  type NameLookup,
  type Subject,
} from '@/lib/labelos/filters';
import {
  createView,
  deleteView,
  listViews,
  patchView,
  runFilter,
  toLookup,
  type NamesJson,
  type Outcome,
  type RunResponse,
  type ViewDto,
} from '@/lib/labelos/filters-client';

export type RunState = { state: 'idle' } | { state: 'loading' } | { state: 'error'; error: string } | { state: 'ready'; response: RunResponse };

const mergeNames = (a: NamesJson, b: NamesJson): NamesJson => ({
  artists: { ...a.artists, ...b.artists },
  parties: { ...a.parties, ...b.parties },
  projects: { ...a.projects, ...b.projects },
});
const NO_NAMES: NamesJson = { artists: {}, parties: {}, projects: {} };

function writeUrl(param: { view?: string; f?: string } | null) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.delete('f');
    if (param?.view) url.searchParams.set('view', param.view);
    else if (param?.f) url.searchParams.set('f', param.f);
    window.history.replaceState(null, '', url);
  } catch {
    /* the filter still works without it */
  }
}

export function useOrgFilter({ orgId, subject, runWhenEmpty }: { orgId: string; subject: Subject; runWhenEmpty: boolean }) {
  const [definition, setDefinitionState] = useState<Definition>(() => emptyDefinition(subject));
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [run, setRun] = useState<RunState>({ state: 'idle' });
  const [names, setNames] = useState<NamesJson>(NO_NAMES);
  const [narrowed, setNarrowed] = useState(false);
  const [views, setViews] = useState<ViewDto[]>([]);
  const [canShare, setCanShare] = useState(false);
  const [viewsReady, setViewsReady] = useState(true);
  const ticket = useRef(0);

  const execute = useCallback(
    async (source: { view: string } | { definition: Definition } | null, offset = 0) => {
      const mine = ++ticket.current;
      const empty = source && 'definition' in source && isEmptyFilter(source.definition);
      if (!source || (empty && !runWhenEmpty)) {
        setRun({ state: 'idle' });
        return;
      }
      if (offset === 0) setRun({ state: 'loading' });
      const res = await runFilter(orgId, source, { offset });
      if (mine !== ticket.current) return; // a newer run owns the screen
      if (!res.ok) {
        // A view that stopped existing for this viewer (404) falls back to the plain list.
        if (res.status === 404 && 'view' in source) {
          setActiveViewId(null);
          writeUrl(null);
          setDefinitionState(emptyDefinition(subject));
          void execute(runWhenEmpty ? { definition: emptyDefinition(subject) } : null);
          return;
        }
        setRun({ state: 'error', error: res.error });
        return;
      }
      const data = res.data;
      setNarrowed(data.narrowed);
      setNames((n) => mergeNames(n, data.names));
      setDefinitionState(data.definition);
      setRun((prev) => {
        // "Show more" appends; everything else replaces.
        if (offset > 0 && prev.state === 'ready' && prev.response.result.kind === data.result.kind) {
          const merged = { ...data, result: { ...data.result, rows: [...(prev.response.result.rows as unknown[]), ...(data.result.rows as unknown[])] } } as RunResponse;
          return { state: 'ready', response: merged };
        }
        return { state: 'ready', response: data };
      });
    },
    [orgId, runWhenEmpty, subject],
  );

  const refreshViews = useCallback(async () => {
    const res = await listViews(orgId, subject);
    if (!res.ok) return;
    setViews(res.data.views);
    setCanShare(res.data.canShare);
    setViewsReady(res.data.schemaReady);
    setNames((n) => mergeNames(n, res.data.names));
  }, [orgId, subject]);

  // Mount: read the URL once, then run.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const viewId = q.get('view');
    const f = q.get('f');
    void refreshViews();
    if (viewId) {
      setActiveViewId(viewId);
      void execute({ view: viewId });
      return;
    }
    if (f) {
      const parsed = decodeDefinition(f);
      if (parsed.ok && parsed.definition.subject === subject) {
        setDefinitionState(parsed.definition);
        void execute({ definition: parsed.definition });
        return;
      }
    }
    void execute(runWhenEmpty ? { definition: emptyDefinition(subject) } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount; later changes go through the setters below
  }, []);

  const setDefinition = useCallback(
    (next: Definition) => {
      setActiveViewId(null);
      setDefinitionState(next);
      writeUrl(isEmptyFilter(next) ? null : { f: encodeDefinition(next) });
      void execute({ definition: next });
    },
    [execute],
  );

  const applyView = useCallback(
    (view: ViewDto) => {
      setActiveViewId(view.id);
      setDefinitionState(view.definition);
      writeUrl({ view: view.id });
      void execute({ view: view.id });
    },
    [execute],
  );

  const clear = useCallback(() => setDefinition(emptyDefinition(subject)), [setDefinition, subject]);

  const loadMore = useCallback(() => {
    if (run.state !== 'ready') return;
    const have = run.response.result.rows.length;
    void execute(activeViewId ? { view: activeViewId } : { definition }, have);
  }, [activeViewId, definition, execute, run]);

  const save = useCallback(
    async (name: string, shared: boolean): Promise<Outcome<ViewDto | null>> => {
      const res = await createView(orgId, { subject, name, definition, shared });
      if (!res.ok) return res;
      await refreshViews();
      if (res.data.view) {
        setActiveViewId(res.data.view.id);
        writeUrl({ view: res.data.view.id });
      }
      return { ok: true, data: res.data.view };
    },
    [definition, orgId, refreshViews, subject],
  );

  const update = useCallback(
    async (id: string, patch: { name?: string; definition?: Definition; shared?: boolean }) => {
      const res = await patchView(orgId, id, patch);
      if (res.ok) await refreshViews();
      return res;
    },
    [orgId, refreshViews],
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await deleteView(orgId, id);
      if (res.ok) {
        await refreshViews();
        if (id === activeViewId) clear();
      }
      return res;
    },
    [activeViewId, clear, orgId, refreshViews],
  );

  const lookup: NameLookup = toLookup(names);
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  return { definition, names: lookup, narrowed, run, views, canShare, viewsReady, activeView, setDefinition, applyView, clear, loadMore, save, update, remove };
}
