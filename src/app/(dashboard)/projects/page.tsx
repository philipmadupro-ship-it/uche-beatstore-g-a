'use client';

/**
 * /projects = PRODUCTION WORKSPACES
 * DAW-style containers. Each project holds track versions, stems,
 * references, and a target BPM/key. This is where work-in-progress lives.
 */

import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Loader2, Music, Layers, Plus, Search, Play, Clock } from 'lucide-react';
import Link from 'next/link';
import { fmtBpm, fmtKey } from '@/lib/audio/format';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { toast } from '@/hooks/useToast';
import { Dropdown } from '@/components/ui/Dropdown';

type SortMode = 'recent' | 'updated' | 'name' | 'tracks';
const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'recent', label: 'Created ↓' },
  { value: 'updated', label: 'Updated ↓' },
  { value: 'name', label: 'Name A→Z' },
  { value: 'tracks', label: 'Track count ↓' },
];

interface Project {
  id: string;
  name: string;
  cover_url?: string | null;
  status?: 'in_progress' | 'final' | 'archived';
  bpm_target?: number | null;
  key_target?: string | null;
  track_count?: number;
  created_at?: string;
  updated_at?: string;
}

const STATUS_STYLE: Record<string, string> = {
  in_progress: 'text-[#c8a84b] border-[#3a2f10] bg-[#1a1505]/80',
  final: 'text-[#8ecf9f] border-[#0a3a1a] bg-[#0a1f0f]/80',
  archived: 'text-[#6a5d4a] border-[#1a160f] bg-[#0e0c08]/80',
};

const STATUS_BORDER: Record<string, string> = {
  in_progress: 'border-[#3a2f10]/60 hover:border-[#c8a84b]/30',
  final: 'border-[#0a3a1a]/60 hover:border-[#8ecf9f]/30',
  archived: 'border-[#1a160f] hover:border-[#2d2620]',
};

const STATUS_GRADIENT: Record<string, string> = {
  in_progress: 'bg-gradient-to-t from-[#1a1505]/90 via-transparent to-transparent',
  final: 'bg-gradient-to-t from-[#0a1f0f]/90 via-transparent to-transparent',
  archived: 'bg-gradient-to-t from-[#0e0c08]/90 via-transparent to-transparent',
};

const STATUS_EMPTY_BG: Record<string, string> = {
  in_progress: 'bg-gradient-to-br from-[#2a2010] to-[#0e0c08]',
  final: 'bg-gradient-to-br from-[#0a2010] to-[#0a0907]',
  archived: 'bg-gradient-to-br from-[#14110d] to-[#0a0907]',
};

function relativeDate(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_progress' | 'final' | 'archived'>('all');
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  // Distinguish "loaded fine, no projects" from "fetch errored" so the
  // empty-state branch below can show a real retry instead of pretending
  // the user just hasn't created anything yet.
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchProjects = async () => {
    setFetchError(null);
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setProjects(Array.isArray(data) ? data : data.projects || []);
    } catch (err) {
      console.error('Error fetching projects:', err);
      setFetchError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  // Auto-refresh on any project mutation — sharing flows, comments, and
  // bulk-from-library actions all land here without manual reload.
  useRealtimeTable({ table: 'projects', onChange: fetchProjects });

  const createProject = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.project?.id) {
        throw new Error(data?.error || `Could not create project (HTTP ${res.status})`);
      }
      window.location.href = `/projects/${data.project.id}`;
    } catch (err) {
      console.error('Create project error:', err);
      toast.error('Create failed', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setCreating(false);
    }
  };

  // Filter + sort. Memoized so a quick text-input doesn't re-sort
  // hundreds of cards on every keystroke.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = projects.filter((p) => {
      if (statusFilter !== 'all' && (p.status || 'in_progress') !== statusFilter) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q);
    });

    const sorted = [...matched];
    switch (sortMode) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'tracks':
        sorted.sort((a, b) => (b.track_count ?? 0) - (a.track_count ?? 0));
        break;
      case 'updated':
        sorted.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
        break;
      case 'recent':
      default:
        sorted.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    }
    return sorted;
  }, [projects, statusFilter, search, sortMode]);

  return (
    <DashboardLayout>
      <div className="max-w-[1400px] mx-auto px-10 pt-10">
        {/* Header */}
        <div className="relative mb-8 rounded-2xl overflow-hidden border border-white/[0.05] bg-gradient-to-br from-[#2A2418]/30 via-[#1a160f]/20 to-[#0a0907] p-8">
          {/* Abstract Image Background */}
          <div
            className="absolute inset-0 z-0 bg-[url('/images/hero-abstract-2.jpg')] bg-cover bg-center opacity-20 mix-blend-overlay"
          />
          <div
            className="absolute -top-32 -right-32 w-80 h-80 rounded-full pointer-events-none opacity-20 z-0"
            style={{ background: 'radial-gradient(circle, #D4BFA0 0%, transparent 70%)' }}
          />
          
          <div className="relative z-10 flex items-end justify-between">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#E8D8B8] mb-2">Work in progress</p>
              <h1 className="text-[40px] font-bold tracking-tight text-white leading-none font-heading mb-3">Projects</h1>
              <p className="text-[11px] text-[#a08a6a] max-w-md">Active production. Tracks you&apos;re still working on — with stems, versions, and references.</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[11px] font-mono text-[#E8D8B8] uppercase tracking-wider">
                {filtered.length} project{filtered.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={createProject}
                disabled={creating}
                className="flex items-center gap-2 bg-white text-black px-4 py-2.5 rounded-full text-[12px] font-medium hover:bg-[#E8DCC8] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                New project
              </button>
            </div>
          </div>
        </div>

        {/* Search + status filter + sort. Same shape as the library page
            so the muscle memory transfers — search input on the left,
            status pills in the middle, sort dropdown on the right. */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4338]" />
            <input
              placeholder="Search projects"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#0e0c08] border border-[#1a160f] rounded-md pl-8 pr-3 py-2 text-[12px] text-[#E8DCC8] placeholder-[#4a4338] focus:outline-none focus:border-[#2d2620]"
            />
          </div>
          <div className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider">
            {(['all', 'in_progress', 'final', 'archived'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  statusFilter === s
                    ? 'bg-[#2A2418] text-[#E8D8B8] border border-[#8A7A5C]'
                    : 'text-[#5a5142] hover:text-[#a08a6a]'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <Dropdown
              value={sortMode}
              onChange={(v) => setSortMode(v as SortMode)}
              options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              label="Sort"
              aria-label="Sort projects"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 size={18} className="animate-spin text-[#4a4338]" />
          </div>
        ) : fetchError ? (
          // Fetch errored — surface the real reason + retry button so the
          // user isn't staring at the "No projects yet" copy thinking
          // their data is gone.
          <div className="text-center py-32">
            <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-[#14110d] border border-[#1a160f] flex items-center justify-center">
              <Layers size={22} className="text-[#c8a84b]" />
            </div>
            <p className="text-sm text-[#E8DCC8] mb-1">Couldn’t load projects</p>
            <p className="text-[11px] text-[#5a5142] mb-6 font-mono">{fetchError}</p>
            <button
              onClick={fetchProjects}
              className="inline-flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] transition-colors"
            >
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          // Two sub-flavours: filtered-to-empty vs genuinely empty. The
          // CTA differs — clearing filters fixes the first; only "create"
          // helps the second.
          (() => {
            const isFiltered = statusFilter !== 'all' || search.trim() !== '';
            return (
              <div className="text-center py-32">
                <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-[#14110d] border border-[#1a160f] flex items-center justify-center">
                  <Layers size={22} className="text-[#3a3328]" />
                </div>
                {isFiltered ? (
                  <>
                    <p className="text-sm text-[#E8DCC8] mb-1">No matches</p>
                    <p className="text-[11px] text-[#5a5142] mb-6">
                      {projects.length} project{projects.length !== 1 ? 's' : ''} hidden by the current filter or search.
                    </p>
                    <button
                      onClick={() => { setStatusFilter('all'); setSearch(''); }}
                      className="inline-flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] transition-colors"
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-[#E8DCC8] mb-1">No projects yet</p>
                    <p className="text-[11px] text-[#5a5142] mb-6">Create a project to group references, stems and versions</p>
                    <button
                      onClick={createProject}
                      disabled={creating}
                      className="inline-flex items-center gap-2 bg-[#14110d] border border-[#1a160f] text-[#E8DCC8] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#2d2620] disabled:opacity-40 transition-colors"
                    >
                      {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      Create first project
                    </button>
                  </>
                )}
              </div>
            );
          })()
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filtered.map((project) => {
              const status = project.status || 'in_progress';
              const updatedAt = project.updated_at ? new Date(project.updated_at) : null;
              const relativeTime = updatedAt ? relativeDate(updatedAt) : null;

              return (
                <Link href={`/projects/${project.id}`} key={project.id} className="group flex flex-col">
                  {/* Cover card */}
                  <div className={`relative aspect-square rounded-xl mb-3 overflow-hidden border transition-all duration-200 ${STATUS_BORDER[status]} group-hover:scale-[1.02]`}>
                    {/* Status-tinted gradient overlay at bottom */}
                    <div className={`absolute inset-0 ${STATUS_GRADIENT[status]} opacity-60`} />

                    {project.cover_url ? (
                      <img loading="lazy" src={project.cover_url} alt={project.name} className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <div className={`absolute inset-0 flex items-center justify-center ${STATUS_EMPTY_BG[status]}`}>
                        <Music size={28} className="text-white/10" />
                      </div>
                    )}

                    {/* Play overlay on hover */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-white/95 flex items-center justify-center shadow-xl">
                        <Play size={18} fill="black" className="text-black ml-0.5" />
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className={`absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full text-[8px] font-mono font-bold uppercase tracking-wider border backdrop-blur-sm ${STATUS_STYLE[status]}`}>
                      {status.replace('_', ' ')}
                    </div>

                    {/* Track count badge */}
                    <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-full">
                      <Music size={9} className="text-[#a08a6a]" />
                      <span className="text-[9px] font-mono text-[#E8DCC8]">{project.track_count || 0}</span>
                    </div>
                  </div>

                  {/* Meta below card */}
                  <h3 className="text-[13px] font-semibold text-[#E8DCC8] truncate leading-tight mb-1.5 group-hover:text-white transition-colors">
                    {project.name}
                  </h3>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {project.bpm_target != null && (
                      <span className="text-[9px] font-mono text-[#5a5142] bg-[#14110d] border border-[#1f1a13] px-1.5 py-0.5 rounded tabular-nums">
                        {fmtBpm(project.bpm_target)}
                      </span>
                    )}
                    {project.key_target && (
                      <span className="text-[9px] font-mono text-[#5a5142] bg-[#14110d] border border-[#1f1a13] px-1.5 py-0.5 rounded uppercase">
                        {fmtKey(project.key_target, null)}
                      </span>
                    )}
                    {relativeTime && (
                      <span className="text-[9px] font-mono text-[#3a3328] flex items-center gap-1 ml-auto">
                        <Clock size={8} />
                        {relativeTime}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
