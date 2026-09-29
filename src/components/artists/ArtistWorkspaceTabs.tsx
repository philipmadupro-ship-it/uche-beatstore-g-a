'use client';

/**
 * The artist workspace — /contacts/[id] in workspace mode.
 *
 *   Overview │ Projects │ Beats │ Songs │ Files │ Messages │ Activity │ Notes
 *
 * Tabs are URL-addressable (?tab=beats). They read from one
 * /api/contacts/[id]/workspace payload; every write goes to its own route and
 * then refetches, so what a tab shows is always what the server derived.
 * Notes and Activity reuse the CRM's own components rather than copies.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, ExternalLink, FileText, Layers, Music, Plus, Sparkles } from 'lucide-react';
import { ASSET_KIND_LABEL, formatBytes, type ProjectAssetKind } from '@/lib/projects/assets';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { BatchActionBar } from '@/components/ui/BatchActionBar';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { toast } from '@/hooks/useToast';
import { relativeDays } from '@/components/crm/contacts-shared';
import { DECISIONS, DECISION_META, MOVING_DECISIONS, type Decision } from '@/lib/contacts/decisions';
import { ENGAGEMENT_LABEL } from '@/lib/contacts/track-engagement';
import type { WorkspaceBeat, WorkspaceProject, WorkspaceSong } from '@/lib/artists/workspace-load';
import { jsonOrThrow, type ReadyWorkspace } from './types';
import { ArtistCommentsPanel } from './ArtistCommentsPanel';
import { ArtistMessagesPanel } from './ArtistMessagesPanel';

export const WORKSPACE_TABS = ['overview', 'projects', 'beats', 'songs', 'files', 'messages', 'activity', 'notes'] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

const TAB_LABEL: Record<WorkspaceTab, string> = {
  overview: 'Overview', projects: 'Projects', beats: 'Beats', songs: 'Songs', files: 'Files', messages: 'Messages', activity: 'Activity', notes: 'Notes',
};

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const CONTROL = 'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';

function readTab(): WorkspaceTab {
  if (typeof window === 'undefined') return 'overview';
  const t = new URLSearchParams(window.location.search).get('tab');
  return (WORKSPACE_TABS as readonly string[]).includes(t ?? '') ? (t as WorkspaceTab) : 'overview';
}

export function ArtistWorkspaceTabs({
  contactId,
  contactName,
  workspace,
  onChanged,
  activity,
  notes,
  tasks,
}: {
  contactId: string;
  contactName: string;
  workspace: ReadyWorkspace;
  onChanged: () => void;
  /** The CRM's own timeline component, rendered as the Activity tab. */
  activity: React.ReactNode;
  /** The CRM's details / tags / notes, rendered as the Notes tab. */
  notes: React.ReactNode;
  /** The CRM's task list, shown on Overview and Notes. */
  tasks: React.ReactNode;
}) {
  // Only ever rendered after the client-side workspace fetch, so reading the
  // URL in the initializer cannot mismatch a server render.
  const [tab, setTab] = useState<WorkspaceTab>(readTab);

  const go = (next: WorkspaceTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <div className="min-w-0" data-testid="artist-workspace">
      <div role="tablist" aria-label={`${contactName} workspace`} className="mb-6 flex gap-1 overflow-x-auto border-b border-white/10">
        {WORKSPACE_TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`ws-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`ws-panel-${t}`}
            onClick={() => go(t)}
            className={`-mb-px shrink-0 border-b px-3 py-2 text-[11px] transition-colors ${tab === t ? 'border-white text-white' : 'border-transparent text-white/50 hover:text-white/80'}`}
          >
            {TAB_LABEL[t]}
            {t === 'beats' && workspace.beats.length > 0 && <span className="ml-1.5 text-white/30">{workspace.beats.length}</span>}
            {t === 'songs' && workspace.songs.length > 0 && <span className="ml-1.5 text-white/30">{workspace.songs.length}</span>}
            {t === 'files' && workspace.files.length > 0 && <span className="ml-1.5 text-white/30">{workspace.files.length}</span>}
            {t === 'messages' && (workspace.messages?.unread ?? 0) + (workspace.messages?.openRequests ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-white/[0.14] px-1.5 text-[10px] text-white" aria-label={`${workspace.messages.unread} unread, ${workspace.messages.openRequests} open requests`}>
                {workspace.messages.unread + workspace.messages.openRequests}
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`ws-panel-${tab}`} aria-labelledby={`ws-tab-${tab}`}>
        {tab === 'overview' && <OverviewTab workspace={workspace} contactName={contactName} tasks={tasks} onOpen={go} />}
        {tab === 'projects' && <ProjectsTab contactId={contactId} contactName={contactName} workspace={workspace} onChanged={onChanged} />}
        {tab === 'beats' && <BeatsTab contactId={contactId} beats={workspace.beats} onChanged={onChanged} />}
        {tab === 'songs' && <SongsTab songs={workspace.songs} beats={workspace.beats} onChanged={onChanged} />}
        {tab === 'files' && <FilesTab contactName={contactName} workspace={workspace} onChanged={onChanged} />}
        {tab === 'messages' && <ArtistMessagesPanel contactId={contactId} contactName={contactName} onCountsChanged={onChanged} />}
        {tab === 'activity' && (
          <>
            <ArtistCommentsPanel
              contactId={contactId}
              contactName={contactName}
              projects={workspace.projects.filter((p) => p.link.in_portal).map((p) => ({ id: p.id, name: p.name }))}
            />
            {activity}
          </>
        )}
        {tab === 'notes' && <div className="space-y-8">{notes}{tasks}</div>}
      </div>
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────── */

function OverviewTab({ workspace, contactName, tasks, onOpen }: {
  workspace: ReadyWorkspace;
  contactName: string;
  tasks: React.ReactNode;
  onOpen: (t: WorkspaceTab) => void;
}) {
  const moving = workspace.beats.filter((b) => b.decision && MOVING_DECISIONS.includes(b.decision));
  const active = workspace.projects.filter((p) => p.status !== 'archived');
  const c = workspace.counts;
  const msgs = workspace.messages;
  return (
    <div className="space-y-8">
      {msgs && (msgs.openRequests > 0 || msgs.unread > 0) && (
        <button
          type="button"
          onClick={() => onOpen('messages')}
          className="flex w-full items-center justify-between rounded-xl border border-white/20 bg-white/[0.06] px-4 py-3 text-left transition-colors hover:bg-white/[0.10]"
        >
          <span className="text-[13px] text-white/80">
            {[
              msgs.openRequests ? `${msgs.openRequests} open request${msgs.openRequests === 1 ? '' : 's'}` : null,
              msgs.unread ? `${msgs.unread} unread message${msgs.unread === 1 ? '' : 's'}` : null,
            ].filter(Boolean).join(' · ')} from {contactName}
          </span>
          <span className="text-[11px] text-white/50">Open messages</span>
        </button>
      )}
      <section aria-labelledby="ws-moving">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="ws-moving" className={LABEL}>What’s moving</h2>
          <p className="text-[11px] text-white/40">
            {[c.interested && `${c.interested} interested`, c.selected && `${c.selected} selected`, c.recording && `${c.recording} recording`, c.released && `${c.released} released`].filter(Boolean).join(' · ') || 'No decisions yet'}
          </p>
        </div>
        {moving.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/40">
            Nothing moving yet. When {contactName} taps Interested in their portal, or you set a decision on the Beats tab, it shows here.
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
            {moving.map((b) => (
              <li key={b.track.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">{b.track.title}</span>
                <span className="text-[11px] text-white/40">{b.projects[0]?.name}</span>
                <DecisionBadge decision={b.decision!} setBy={b.decisionSetBy} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ws-active">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="ws-active" className={LABEL}>Active projects</h2>
          <button type="button" onClick={() => onOpen('projects')} className="text-[11px] text-white/50 hover:text-white">All projects</button>
        </div>
        {active.length === 0 ? (
          <p className="text-[11px] text-white/40">No active projects.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {active.slice(0, 4).map((p) => <ProjectCardMini key={p.id} project={p} />)}
          </div>
        )}
      </section>

      {tasks}
    </div>
  );
}

function ProjectCardMini({ project }: { project: WorkspaceProject }) {
  return (
    <Link href={`/projects/${project.id}`} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-3 transition-colors hover:border-white/20">
      <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
        <ArtworkFallback src={project.cover_url} seed={project.id} kind="project" sizes="48px" className="object-cover">
          <Layers size={16} className="text-white/30" aria-hidden="true" />
        </ArtworkFallback>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-white/80">{project.name}</span>
        <span className="block text-[11px] text-white/40">
          {project.trackCount} track{project.trackCount === 1 ? '' : 's'}
          {project.link.in_portal ? (project.newForArtist > 0 ? ` · ${project.newForArtist} unseen` : ' · in portal') : ''}
        </span>
      </span>
    </Link>
  );
}

/* ── Projects ─────────────────────────────────────────────────────────── */

function ProjectsTab({ contactId, contactName, workspace, onChanged }: {
  contactId: string;
  contactName: string;
  workspace: ReadyWorkspace;
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [allProjects, setAllProjects] = useState<Array<{ id: string; name: string }> | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/projects').then((r) => (r.ok ? r.json() : { projects: [] })).then((d) => {
      if (alive) setAllProjects(((d.projects ?? []) as Array<{ id: string; name: string }>).map((p) => ({ id: p.id, name: p.name })));
    }).catch(() => { if (alive) setAllProjects([]); });
    return () => { alive = false; };
  }, []);

  const linked = new Set(workspace.projects.map((p) => p.id));
  const linkable = (allProjects ?? []).filter((p) => !linked.has(p.id));

  const link = async (projectId: string) => {
    setBusy(projectId);
    try {
      await jsonOrThrow(await fetch(`/api/projects/${projectId}/contacts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: contactId }),
      }));
      onChanged();
    } catch (err) {
      toast.error('Could not link project', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(null);
    }
  };

  const createProject = async () => {
    setBusy('new');
    try {
      const { project } = await jsonOrThrow<{ project: { id: string } }>(await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() || `${contactName} — New project` }),
      }));
      await link(project.id);
      setName('');
      setCreating(false);
      toast.success('Project created', 'Add beats to it, then share it with the artist.');
    } catch (err) {
      toast.error('Could not create project', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(null);
    }
  };

  const patch = async (projectId: string, body: Record<string, boolean>) => {
    setBusy(projectId);
    try {
      if (body.in_portal && !workspace.portal) {
        await jsonOrThrow(await fetch(`/api/contacts/${contactId}/portal`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create' }),
        }));
      }
      await jsonOrThrow(await fetch(`/api/projects/${projectId}/contacts/${contactId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }));
      onChanged();
    } catch (err) {
      toast.error('Could not update', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(null);
    }
  };

  const share = async (projectId: string) => {
    setBusy(projectId);
    try {
      const data = await jsonOrThrow<{ recipient: string }>(await fetch(`/api/projects/${projectId}/contacts/${contactId}/share`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }));
      toast.success(`Shared with ${contactName}`, `Invite sent to ${data.recipient}`);
      onChanged();
    } catch (err) {
      toast.error('Share failed', err instanceof Error ? err.message : 'Try again');
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {creating ? (
          <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); void createProject(); }}>
            <label className="flex-1">
              <span className="sr-only">Project name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setCreating(false); }}
                placeholder={`${contactName} — New project`}
                className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
              />
            </label>
            <button type="submit" disabled={busy === 'new'} className={CONTROL}>Create</button>
            <button type="button" onClick={() => setCreating(false)} className="px-2 text-[11px] text-white/50 hover:text-white">Cancel</button>
          </form>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className={`${CONTROL} flex items-center gap-1.5`}>
            <Plus size={12} aria-hidden="true" /> New project for {contactName}
          </button>
        )}
        {!creating && linkable.length > 0 && (
          <Dropdown
            value=""
            onChange={(v) => { if (v) void link(v); }}
            options={linkable.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Link an existing project"
            aria-label="Link an existing project"
            menuWidth={260}
          />
        )}
      </div>

      {workspace.projects.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/40">
          No projects yet. Create one for {contactName}, add beats, then share it — their portal shows everything you add from then on.
        </p>
      ) : (
        <ul className="space-y-3">
          {workspace.projects.map((p) => (
            <li key={p.id} className="rounded-xl border border-white/10 bg-[#0D0D0A] p-4" data-testid={`ws-project-${p.id}`}>
              <div className="flex items-start gap-3">
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
                  <ArtworkFallback src={p.cover_url} seed={p.id} kind="project" sizes="56px" className="object-cover">
                    <Layers size={18} className="text-white/30" aria-hidden="true" />
                  </ArtworkFallback>
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/projects/${p.id}`} className="inline-flex items-center gap-1.5 text-[14px] text-white/90 hover:text-white">
                    {p.name} <ExternalLink size={11} className="text-white/30" aria-hidden="true" />
                  </Link>
                  <p className="mt-0.5 text-[11px] text-white/40">
                    {p.beats} beat{p.beats === 1 ? '' : 's'} · {p.songs} song{p.songs === 1 ? '' : 's'}
                    {p.status === 'archived' ? ' · archived' : ''}
                    {p.link.in_portal && p.newForArtist > 0 ? <span className="text-[#6DC6A4]"> · {p.newForArtist} not seen yet</span> : null}
                  </p>
                </div>
                {!p.link.in_portal && (
                  <button type="button" disabled={busy === p.id} onClick={() => share(p.id)} className={CONTROL}>
                    Share with {contactName}
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-white/[0.06] pt-3">
                <Toggle label="In portal" checked={p.link.in_portal} disabled={busy === p.id} onChange={(v) => patch(p.id, { in_portal: v })} />
                <Toggle label="Downloads" checked={p.link.allow_downloads} disabled={busy === p.id || !p.link.in_portal} onChange={(v) => patch(p.id, { allow_downloads: v })} />
                <span className="ml-auto text-[11px] text-white/30">
                  {p.link.last_notified_at ? `Last notified ${relativeDays(p.link.last_notified_at)}` : p.link.in_portal ? 'Not notified yet' : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-[11px] text-white/60 disabled:opacity-40"
    >
      <span className={`relative inline-flex h-4 w-7 items-center rounded-full border transition-colors ${checked ? 'border-white/30 bg-white/[0.14]' : 'border-white/10 bg-white/[0.06]'}`}>
        <span className={`absolute h-2.5 w-2.5 rounded-full transition-transform ${checked ? 'translate-x-[14px] bg-[#6DC6A4]' : 'translate-x-[3px] bg-white/40'}`} />
      </span>
      {label}
    </button>
  );
}

/* ── Beats ────────────────────────────────────────────────────────────── */

const DECISION_OPTIONS: DropdownOption[] = [
  { value: 'none', label: 'No decision' },
  ...DECISIONS.map((d, i) => ({ value: d, label: DECISION_META[d].label, separator: d === 'passed' && i > 0 })),
];

function BeatsTab({ contactId, beats, onChanged }: { contactId: string; beats: WorkspaceBeat[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'portal' | 'decided' | 'undecided'>('all');

  const shown = useMemo(() => beats.filter((b) => {
    if (filter === 'portal') return b.inPortal;
    if (filter === 'decided') return !!b.decision;
    if (filter === 'undecided') return !b.decision;
    return true;
  }), [beats, filter]);

  const setDecision = useCallback(async (trackIds: string[], decision: Decision | null) => {
    setBusy(true);
    try {
      await jsonOrThrow(await fetch(`/api/contacts/${contactId}/decisions`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ track_ids: trackIds, decision }),
      }));
      setSelected(new Set());
      onChanged();
    } catch (err) {
      toast.error('Could not save decision', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(false);
    }
  }, [contactId, onChanged]);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (beats.length === 0) {
    return <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/40">No beats yet. Beats arrive here when you send them or add them to one of this artist’s projects.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Dropdown
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
          options={[
            { value: 'all', label: 'All beats' },
            { value: 'portal', label: 'In their portal' },
            { value: 'decided', label: 'With a decision' },
            { value: 'undecided', label: 'No decision yet' },
          ]}
          aria-label="Filter beats"
        />
        <span className="text-[11px] text-white/40">{shown.length} of {beats.length}</span>
      </div>

      <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
        {shown.map((b) => (
          <li key={b.track.id} className="flex items-center gap-3 px-3 py-3" data-testid={`ws-beat-${b.track.id}`}>
            <input
              type="checkbox"
              aria-label={`Select ${b.track.title}`}
              checked={selected.has(b.track.id)}
              onChange={() => toggle(b.track.id)}
              className="h-3.5 w-3.5 shrink-0 accent-white"
            />
            <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
              <ArtworkFallback src={b.track.cover_url} seed={b.track.id} kind="track" sizes="40px" className="object-cover">
                <Music size={14} className="text-white/30" aria-hidden="true" />
              </ArtworkFallback>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-white/80">{b.track.title}</p>
              <p className="truncate text-[11px] text-white/40">
                {[b.projects[0] ? `via ${b.projects[0].name}` : 'sent directly', b.engagement.lastPlayedAt ? `played ${relativeDays(b.engagement.lastPlayedAt)}` : null].filter(Boolean).join(' · ')}
              </p>
            </div>
            <EngagementChip beat={b} />
            <div className="w-[132px] shrink-0">
              <Dropdown
                value={b.decision ?? 'none'}
                onChange={(v) => void setDecision([b.track.id], v === 'none' ? null : (v as Decision))}
                options={DECISION_OPTIONS}
                disabled={busy}
                align="right"
                aria-label={`Decision for ${b.track.title}`}
              />
            </div>
          </li>
        ))}
      </ul>

      {selected.size > 0 && (
        <BatchActionBar
          count={selected.size}
          noun={['beat', 'beats']}
          onClear={() => setSelected(new Set())}
          busy={busy}
          actions={[
            { label: 'Interested', onClick: () => void setDecision([...selected], 'interested') },
            { label: 'Selected', onClick: () => void setDecision([...selected], 'selected') },
            { label: 'Recording', onClick: () => void setDecision([...selected], 'recording') },
            { label: 'Passed', onClick: () => void setDecision([...selected], 'passed') },
            { label: 'Clear', onClick: () => void setDecision([...selected], null) },
          ]}
        />
      )}
    </div>
  );
}

function EngagementChip({ beat }: { beat: WorkspaceBeat }) {
  const step = beat.engagement.step;
  if (!step) return <span className="hidden w-[112px] shrink-0 text-right text-[11px] text-white/20 sm:block">—</span>;
  const text = step === 'played' && beat.engagement.plays > 1 ? `Played ${beat.engagement.plays}×` : ENGAGEMENT_LABEL[step];
  return (
    <span className={`hidden w-[112px] shrink-0 truncate pr-1 text-right text-[11px] sm:block ${step === 'downloaded' || step === 'played' ? 'text-[#6DC6A4]' : 'text-white/50'}`} title={beat.engagement.at ? `since ${new Date(beat.engagement.at).toLocaleDateString()}` : undefined}>
      {text}
    </span>
  );
}

export function DecisionBadge({ decision, setBy }: { decision: Decision; setBy: 'producer' | 'artist' | null }) {
  const tone = DECISION_META[decision].tone;
  const color = tone === 'positive' ? 'border-[#6DC6A4]/40 text-[#6DC6A4]' : tone === 'muted' ? 'border-white/10 text-white/40' : 'border-white/20 text-white/70';
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] ${color}`} title={setBy === 'artist' ? 'Set by the artist' : 'Set by you'}>
      {setBy === 'artist' && <Sparkles size={10} aria-hidden="true" />}
      {DECISION_META[decision].label}
    </span>
  );
}

/* ── Songs ────────────────────────────────────────────────────────────── */

function SongsTab({ songs, beats, onChanged }: { songs: WorkspaceSong[]; beats: WorkspaceBeat[]; onChanged: () => void }) {
  const [library, setLibrary] = useState<Array<{ id: string; title: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/tracks?type=beat').then((r) => (r.ok ? r.json() : [])).then((d) => {
      const rows = (Array.isArray(d) ? d : d.tracks ?? []) as Array<{ id: string; title: string }>;
      if (alive) setLibrary(rows.map((t) => ({ id: t.id, title: t.title })));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // This artist's beats first, then the rest of the library.
  const options: DropdownOption[] = useMemo(() => {
    const mine = beats.map((b) => ({ value: b.track.id, label: b.track.title ?? 'Untitled' }));
    const mineIds = new Set(mine.map((m) => m.value));
    const rest = library.filter((t) => !mineIds.has(t.id)).map((t, i) => ({ value: t.id, label: t.title, separator: i === 0 && mine.length > 0, hint: i === 0 ? 'Library' : undefined }));
    return [{ value: 'none', label: 'Not set' }, ...mine, ...rest];
  }, [beats, library]);

  const setBeat = async (songId: string, beatId: string | null) => {
    setBusy(songId);
    try {
      await jsonOrThrow(await fetch(`/api/tracks/${songId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ beat_track_id: beatId }),
      }));
      onChanged();
    } catch (err) {
      toast.error('Could not set the beat', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(null);
    }
  };

  if (songs.length === 0) {
    return (
      <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/40">
        No songs yet. Upload a demo as a song in the Library, add it to one of this artist’s projects, then set the beat it’s built on here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
      {songs.map((s) => (
        <li key={s.track.id} className="flex items-center gap-3 px-3 py-3" data-testid={`ws-song-${s.track.id}`}>
          <div className="min-w-0 flex-1">
            <Link href={`/library/${s.track.id}`} className="block truncate text-[13px] text-white/80 hover:text-white">{s.track.title}</Link>
            <p className="truncate text-[11px] text-white/40">
              {s.beat ? `Built on ${s.beat.title}${s.beats.length > 1 ? ` + ${s.beats.length - 1} more` : ''}` : 'Beat not set'}
              {s.projects[0] ? ` · ${s.projects[0].name}` : ''}
              {s.track.status ? ` · ${s.track.status.replace('_', ' ')}` : ''}
            </p>
          </div>
          <div className="w-[180px] shrink-0">
            <Dropdown
              value={s.beat?.id ?? 'none'}
              onChange={(v) => void setBeat(s.track.id, v === 'none' ? null : v)}
              options={options}
              disabled={busy === s.track.id}
              align="right"
              menuWidth={240}
              aria-label={`Beat ${s.track.title} is built on`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── Files ────────────────────────────────────────────────────────────── */

function FilesTab({ contactName, workspace, onChanged }: { contactName: string; workspace: ReadyWorkspace; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const byProject = useMemo(() => {
    const groups = new Map<string, { name: string; files: ReadyWorkspace['files'] }>();
    for (const f of workspace.files) {
      const g = groups.get(f.projectId) ?? { name: f.projectName, files: [] };
      g.files.push(f);
      groups.set(f.projectId, g);
    }
    return [...groups.entries()];
  }, [workspace.files]);

  const togglePortal = async (f: ReadyWorkspace['files'][number]) => {
    setBusy(f.id);
    try {
      await jsonOrThrow(await fetch(`/api/projects/${f.projectId}/assets/${f.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ in_portal: !f.in_portal }),
      }));
      onChanged();
    } catch (err) {
      toast.error('Could not update the file', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="ws-project-files">
        <h2 id="ws-project-files" className={`${LABEL} mb-3`}>Project files</h2>
        {!workspace.filesReady ? (
          <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/40">
            Project files need migration 127 applied on Supabase.
          </p>
        ) : byProject.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/40">
            No project files yet. Add references, artwork or lyric sheets on a project page, switch them into the portal, and {contactName} can open them.
          </p>
        ) : (
          <div className="space-y-4">
            {byProject.map(([projectId, g]) => (
              <div key={projectId}>
                <Link href={`/projects/${projectId}`} className="mb-1.5 inline-block text-[11px] text-white/50 hover:text-white">{g.name}</Link>
                <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
                  {g.files.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-3 py-2.5" data-testid={`ws-file-${f.id}`}>
                      <FileText size={14} className="shrink-0 text-white/40" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-[13px] text-white/80">
                          <span className="truncate">{f.label}</span>
                          {f.isNewForArtist && <span className="shrink-0 text-[10px] font-mono uppercase tracking-[0.2em] text-[#6DC6A4]">Not seen</span>}
                        </p>
                        <p className="truncate text-[11px] text-white/40">
                          {[ASSET_KIND_LABEL[f.kind as ProjectAssetKind] ?? 'File', formatBytes(f.size_bytes), f.downloadedAt ? `downloaded ${relativeDays(f.downloadedAt)}` : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <Toggle label="In portal" checked={f.in_portal} disabled={busy === f.id} onChange={() => void togglePortal(f)} />
                      <a href={f.downloadUrl} download aria-label={`Download ${f.label}`} className="shrink-0 rounded-lg p-2 text-white/50 hover:bg-white/[0.10] hover:text-white">
                        <Download size={14} aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="ws-track-files">
        <h2 id="ws-track-files" className={`${LABEL} mb-3`}>Track files</h2>
        {workspace.trackFiles.length === 0 ? (
          <p className="text-[11px] text-white/40">No WAVs or stems on this artist’s beats and songs yet.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
            {workspace.trackFiles.map((t) => (
              <li key={t.trackId} className="flex items-center gap-3 px-3 py-2.5">
                <Music size={14} className="shrink-0 text-white/40" aria-hidden="true" />
                <Link href={`/library/${t.trackId}`} className="min-w-0 flex-1 truncate text-[13px] text-white/80 hover:text-white">{t.title}</Link>
                <span className="shrink-0 text-[11px] text-white/40">
                  {[t.hasWav ? 'WAV' : null, t.stems ? `${t.stems} stem${t.stems === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                </span>
                <span className={`w-[112px] shrink-0 text-right text-[11px] ${t.downloads > 0 ? 'text-[#6DC6A4]' : 'text-white/30'}`}>
                  {t.downloads > 0 ? `Downloaded ${t.downloads}×` : t.inPortal ? 'In portal' : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
