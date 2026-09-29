'use client';

/**
 * The artist's portal: a small library of the projects the producer put in
 * it, with far fewer functions than the dashboard — play, NEW markers,
 * Interested / Pass, and downloads where the project allows them. No CRM, no
 * editing, no store chrome, no checkout.
 *
 * Playback reuses the share page's `WavePlayer` over the signed share-media
 * URLs the API returns. Plays are logged by watching the global player store
 * (a track counts once it actually starts), so the shared player needs no
 * portal-specific hook.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Heart, Lock, Music, X } from 'lucide-react';
import { WavePlayer } from '@/components/player/WavePlayer';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { ArtworkThemeProvider } from '@/components/providers/ArtworkThemeProvider';
import { usePlayer } from '@/hooks/usePlayer';
import { DECISION_META, ARTIST_DECISIONS } from '@/lib/contacts/decisions';
import type { PortalTrack, PortalView } from '@/lib/artist-portal/view';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; view: PortalView }
  | { kind: 'password'; error: string | null }
  | { kind: 'gone'; message: string }
  | { kind: 'error'; message: string };

type Tab = 'beats' | 'songs';

function fmtKey(t: PortalTrack): string | null {
  if (!t.key) return null;
  return `${t.key}${t.scale === 'minor' ? 'm' : ''}`;
}

export function ArtistPortal({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const passwordRef = useRef('');
  const [tab, setTab] = useState<Tab>('beats');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => (
    passwordRef.current ? { 'x-share-password': passwordRef.current } : {}
  ), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}`, { headers: headers(), cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) { setState({ kind: 'password', error: passwordRef.current ? (body.error ?? 'Incorrect password') : null }); return; }
      if (res.status === 404) { setState({ kind: 'gone', message: 'This link does not exist.' }); return; }
      if (res.status === 410) { setState({ kind: 'gone', message: 'This link is no longer active. Ask for a new one.' }); return; }
      if (!res.ok) { setState({ kind: 'error', message: body.error ?? 'Something went wrong.' }); return; }
      setState({ kind: 'ready', view: body as PortalView });
    } catch {
      setState({ kind: 'error', message: 'Could not reach the server.' });
    }
  }, [token, headers]);

  useEffect(() => { void load(); }, [load]);

  const view = state.kind === 'ready' ? state.view : null;

  const visible = useMemo(() => {
    if (!view) return [];
    return view.tracks.filter((t) =>
      (tab === 'songs' ? t.type === 'song' : t.type !== 'song')
      && (!projectFilter || t.projectIds.includes(projectFilter)));
  }, [view, tab, projectFilter]);

  const active = view?.tracks.find((t) => t.id === activeId) ?? null;

  // Log a play once the active track actually starts.
  const isPlaying = usePlayer((s) => s.isPlaying);
  const setPlaying = usePlayer((s) => s.setPlaying);
  const logged = useRef(new Set<string>());
  useEffect(() => {
    if (!isPlaying || !activeId || logged.current.has(activeId)) return;
    logged.current.add(activeId);
    void fetch(`/api/portal/${encodeURIComponent(token)}/play`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers() },
      body: JSON.stringify({ track_id: activeId }),
    }).catch(() => {});
  }, [isPlaying, activeId, token, headers]);

  // Leaving the page stops the audio rather than orphaning it in the store.
  useEffect(() => () => setPlaying(false), [setPlaying]);

  const choose = (t: PortalTrack) => {
    if (activeId === t.id) { setPlaying(!isPlaying); return; }
    setActiveId(t.id);
    setPlaying(true);
  };

  const react = async (t: PortalTrack, decision: 'interested' | 'passed') => {
    if (!view) return;
    const next = t.decision === decision ? null : decision;
    setBusy(t.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/reaction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers() },
        body: JSON.stringify({ track_id: t.id, decision: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok || res.status === 409) {
        setState({
          kind: 'ready',
          view: {
            ...view,
            tracks: view.tracks.map((x) => x.id === t.id
              ? { ...x, decision: body.decision ?? null, decisionSetBy: body.decisionSetBy ?? null }
              : x),
          },
        });
        if (res.status === 409) setNotice(body.error ?? 'This beat has moved on.');
      } else {
        setNotice(body.error ?? 'Could not save that.');
      }
    } catch {
      setNotice('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const download = async (t: PortalTrack) => {
    const url = `/api/portal/${encodeURIComponent(token)}/download/${encodeURIComponent(t.id)}`;
    if (!passwordRef.current) {
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    // A locked portal needs the password header, which a plain link cannot send.
    setBusy(t.id);
    try {
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) { setNotice('Download failed.'); return; }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${t.title}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } finally {
      setBusy(null);
    }
  };

  if (state.kind === 'loading') {
    return <Shell><p className="py-24 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Loading your library…</p></Shell>;
  }
  if (state.kind === 'gone' || state.kind === 'error') {
    return (
      <Shell>
        <div className="mx-auto max-w-sm py-24 text-center">
          <p className="text-sm text-white/80">{state.message}</p>
        </div>
      </Shell>
    );
  }
  if (state.kind === 'password') {
    return (
      <Shell>
        <form
          className="mx-auto max-w-sm space-y-4 py-24 text-center"
          onSubmit={(e) => { e.preventDefault(); passwordRef.current = password; setState({ kind: 'loading' }); void load(); }}
        >
          <Lock size={20} className="mx-auto text-white/60" aria-hidden="true" />
          <h1 className="text-sm text-white/80">This library is locked</h1>
          <label className="block">
            <span className="sr-only">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              placeholder="Password"
              className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-sm text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
            />
          </label>
          {state.error && <p role="alert" className="text-xs text-[var(--error-text)]">{state.error}</p>}
          <button type="submit" className="w-full rounded-lg bg-white px-4 py-3 text-sm font-medium text-[#090907] hover:bg-white/90">Open</button>
        </form>
      </Shell>
    );
  }

  const v = state.view;
  const totalNew = v.tracks.filter((t) => t.isNew).length;
  const hasSongs = v.tracks.some((t) => t.type === 'song');

  return (
    <ArtworkThemeProvider theme={v.artworkTheme}>
      <Shell>
        <header className="flex items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Private library</p>
            <h1 className="mt-2 truncate font-heading text-[32px] leading-tight text-white/90 sm:text-[40px]">{v.producer.name || 'Your producer'}</h1>
          </div>
          {v.portal.artistName && (
            <p className="shrink-0 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">for {v.portal.artistName}</p>
          )}
        </header>

        {v.projects.length === 0 ? (
          <p className="py-16 text-center text-sm text-white/60">Nothing here yet — your producer hasn’t shared a project with you.</p>
        ) : (
          <>
            <section aria-labelledby="portal-projects" className="mt-8">
              <div className="mb-3 flex items-center justify-between gap-4">
                <h2 id="portal-projects" className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Projects</h2>
                {totalNew > 0 && (
                  <span className="text-right font-mono text-[10px] uppercase tracking-[0.2em] text-[#6DC6A4]">
                    {totalNew} new<span className="hidden sm:inline"> since your last visit</span>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {v.projects.map((p) => {
                  const selected = projectFilter === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setProjectFilter(selected ? null : p.id)}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? 'border-white/30 bg-white/[0.14]' : 'border-white/10 bg-[#0D0D0A] hover:border-white/20'}`}
                    >
                      <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
                        <ArtworkFallback src={p.cover_url} seed={p.id} kind="project" sizes="56px" className="object-cover">
                          <Music size={18} className="text-white/30" aria-hidden="true" />
                        </ArtworkFallback>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-white/80">{p.name}</span>
                        <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                          {p.beats} beat{p.beats === 1 ? '' : 's'}{p.songs ? ` · ${p.songs} song${p.songs === 1 ? '' : 's'}` : ''}
                        </span>
                      </span>
                      {p.newCount > 0 && (
                        <span className="shrink-0 rounded-lg border border-[#6DC6A4]/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#6DC6A4]">{p.newCount} new</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="portal-library" className="mt-10">
              <h2 id="portal-library" className="sr-only">Library</h2>
              <div role="tablist" aria-label="Library" className="mb-4 flex gap-2">
                {(['beats', 'songs'] as const).filter((t) => t === 'beats' || hasSongs).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${tab === t ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]'}`}
                  >
                    {t === 'beats' ? 'Beats' : 'Songs'}
                  </button>
                ))}
              </div>

              {active && active.streamUrl && (
                <div className="mb-4 rounded-xl border border-white/10 bg-[#0D0D0A] p-4">
                  <p className="mb-3 truncate text-sm text-white/80">{active.title}</p>
                  <WavePlayer key={active.id} url={active.streamUrl} peaksUrl={active.peaksUrl} publicSrc />
                </div>
              )}

              {notice && <p role="status" className="mb-3 text-xs text-white/60">{notice}</p>}

              {visible.length === 0 ? (
                <p className="py-10 text-center text-sm text-white/40">{tab === 'songs' ? 'No songs yet.' : 'No beats here yet.'}</p>
              ) : (
                <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
                  {visible.map((t) => {
                    const isActive = activeId === t.id;
                    const artistCanReact = t.type !== 'song' && (t.decision === null || ARTIST_DECISIONS.includes(t.decision));
                    const key = fmtKey(t);
                    return (
                      <li key={t.id} className="flex items-center gap-3 px-3 py-3" data-track-id={t.id}>
                        <button
                          type="button"
                          onClick={() => choose(t)}
                          disabled={!t.streamUrl}
                          aria-label={`${isActive && isPlaying ? 'Pause' : 'Play'} ${t.title}`}
                          className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white/[0.06] disabled:opacity-40"
                        >
                          <ArtworkFallback src={t.cover_url} seed={t.id} kind="track" sizes="44px" className="object-cover">
                            <Music size={16} className="text-white/30" aria-hidden="true" />
                          </ArtworkFallback>
                          {isActive && <span className="absolute inset-0 ring-1 ring-inset ring-white/60" aria-hidden="true" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 truncate text-sm text-white/80">
                            <span className="truncate">{t.title}</span>
                            {t.isNew && <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[#6DC6A4]">New</span>}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                            {[t.bpm ? `${Math.round(t.bpm)} BPM` : null, key, t.builtOn ? `Built on ${t.builtOn.title}` : null].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </div>
                        {t.type !== 'song' && (artistCanReact ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              aria-pressed={t.decision === 'interested'}
                              disabled={busy === t.id}
                              onClick={() => react(t, 'interested')}
                              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40 ${t.decision === 'interested' ? 'border-[#6DC6A4]/50 bg-white/[0.14] text-[#6DC6A4]' : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]'}`}
                            >
                              <Heart size={12} aria-hidden="true" fill={t.decision === 'interested' ? 'currentColor' : 'none'} />
                              <span className="hidden sm:inline">Interested</span>
                            </button>
                            <button
                              type="button"
                              aria-pressed={t.decision === 'passed'}
                              disabled={busy === t.id}
                              onClick={() => react(t, 'passed')}
                              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40 ${t.decision === 'passed' ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]'}`}
                            >
                              <X size={12} aria-hidden="true" />
                              <span className="hidden sm:inline">Pass</span>
                            </button>
                          </div>
                        ) : t.decision ? (
                          <span className="shrink-0 rounded-lg border border-white/20 px-2.5 py-1.5 text-xs text-white/70">{DECISION_META[t.decision].label}</span>
                        ) : null)}
                        {t.canDownload && (
                          <button
                            type="button"
                            onClick={() => download(t)}
                            disabled={busy === t.id}
                            aria-label={`Download ${t.title}`}
                            className="shrink-0 rounded-lg p-2 text-white/60 transition-colors hover:bg-white/[0.10] hover:text-white disabled:opacity-40"
                          >
                            <Download size={16} aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </Shell>
    </ArtworkThemeProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#090907] text-white/80">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-12">{children}</div>
    </main>
  );
}
