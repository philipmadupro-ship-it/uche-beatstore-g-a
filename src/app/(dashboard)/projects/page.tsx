'use client';

/**
 * /projects = PRODUCTION WORKSPACES
 * DAW-style containers. Each project holds track versions, stems,
 * references, and a target BPM/key. This is where work-in-progress lives.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader, PageContainer } from '@/components/layout/PageHeader';
import { Loader2, Music, Layers, Plus, Clock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRealtimeTable } from '@/hooks/useRealtimeTable';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { ProjectFilterBar } from '@/components/projects/ProjectFilterBar';
import { ProjectOptionsMenu } from '@/components/projects/ProjectOptionsMenu';
import { CreateProjectModal } from '@/components/layout/CreateProjectModal';
import { MediaCard } from '@/components/ui/MediaCard';
import {
  filterAndSortProjects,
  DEFAULT_PROJECT_FILTERS,
  type ProjectFilterState,
  type ProjectListItem,
} from '@/lib/projects/filters';

interface Project extends ProjectListItem {
  status?: 'in_progress' | 'final' | 'archived';
  cover_url?: string | null;
  preview_covers?: string[];
  bpm_target?: number | null;
  key_target?: string | null;
  is_public?: boolean;
  pinned?: boolean;
}

interface FolderRow { id: string; name: string; color?: string | null; cover_urls?: string[] }

const RECENTLY_OPENED_KEY = 'antigravity-recent-projects';
const MAX_RECENT = 8;

function loadRecentIds(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(RECENTLY_OPENED_KEY) || '[]'); } catch { return []; }
}
function trackRecentOpen(id: string) {
  const prev = loadRecentIds().filter((x) => x !== id);
  localStorage.setItem(RECENTLY_OPENED_KEY, JSON.stringify([id, ...prev].slice(0, MAX_RECENT)));
}

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
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [filters, setFilters] = useState<ProjectFilterState>(() => ({ ...DEFAULT_PROJECT_FILTERS, tags: new Set() }));
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [togglingPin, setTogglingPin] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const hasMounted = useRef(false);
  const router = useRouter();
  useEffect(() => { setRecentIds(loadRecentIds()); hasMounted.current = true; }, []);

  const togglePin = async (project: Project, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const next = !project.pinned;
    setTogglingPin(project.id);
    setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, pinned: next } : p));
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      });
    } catch {
      setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, pinned: !next } : p));
    } finally { setTogglingPin(null); }
  };

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

  const fetchFolders = async () => {
    try {
      const res = await fetch('/api/projects/folders');
      if (!res.ok) return;
      const data = await res.json();
      setFolders(data.folders ?? []);
    } catch {
      // best-effort
    }
  };
  const refreshProjectsAndFolders = () => {
    fetchProjects();
    fetchFolders();
  };

  useEffect(() => {
    fetchProjects();
    fetchFolders();
  }, []);
  const refreshProjects = useDebouncedCallback(fetchProjects, 500);
  const refreshFolders = useDebouncedCallback(fetchFolders, 500);

  // Auto-refresh on any project mutation — sharing flows, comments, and
  // bulk-from-library actions all land here without manual reload. Tag +
  // folder-membership changes re-attach via the list fetch so chips stay live.
  useRealtimeTable({ table: 'projects', onChange: refreshProjects });
  useRealtimeTable({ table: 'project_tags', onChange: refreshProjects });
  useRealtimeTable({ table: 'project_folder_items', onChange: refreshProjects });
  useRealtimeTable({ table: 'project_tracks', onChange: refreshProjects });
  useRealtimeTable({ table: 'tracks', onChange: refreshProjects });
  useRealtimeTable({ table: 'project_folders', onChange: refreshFolders });

  // Filter + sort delegated to the pure, tested helper (lib/projects/filters).
  // Pinned projects float to the very top within the sorted results.
  const filtered = useMemo(() => {
    const result = filterAndSortProjects(projects, filters) as Project[];
    const pinned = result.filter((p) => p.pinned);
    const rest = result.filter((p) => !p.pinned);
    return [...pinned, ...rest];
  }, [projects, filters]);

  const isFiltered =
    filters.search.trim() !== '' || filters.status !== 'all' ||
    filters.folder !== 'all' || filters.tags.size > 0;

  // Recently-opened row — 4 most recent, excluding projects in the current filtered list.
  const recentProjects = useMemo(() => {
    if (!hasMounted.current) return [];
    const byId = new Map(projects.map((p) => [p.id, p]));
    return recentIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 4) as Project[];
  }, [recentIds, projects]);

  const foldersWithCovers = useMemo(() => folders.map((folder) => ({
    ...folder,
    cover_urls: projects
      .filter((project) => (project.folder_ids ?? []).includes(folder.id))
      .flatMap((project) => [project.cover_url, ...(project.preview_covers ?? [])])
      .filter(Boolean)
      .filter((cover, index, all) => all.indexOf(cover) === index)
      .slice(0, 4) as string[],
  })), [folders, projects]);

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          eyebrow="Work in progress"
          title="Projects"
          description="Active production — tracks you're still working on, with stems, versions, and references."
          meta={`${filtered.length} project${filtered.length !== 1 ? 's' : ''}`}
          actions={(
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 bg-white text-black px-4 py-2.5 rounded-full text-[12px] font-medium hover:bg-[#F7EBDD] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all min-h-[44px]"
            >
              <Plus size={14} />
              New project
            </button>
          )}
        />

        {/* Folder chips + search + collapsible tag/status/sort filters. */}
        <ProjectFilterBar
          value={filters}
          onChange={setFilters}
          folders={foldersWithCovers}
          onFoldersChanged={fetchFolders}
          resultCount={filtered.length}
        />

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 size={18} className="animate-spin text-[#837B6D]" />
          </div>
        ) : fetchError ? (
          // Fetch errored — surface the real reason + retry button so the
          // user isn't staring at the "No projects yet" copy thinking
          // their data is gone.
          <div className="text-center py-32">
            <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-[#171511] border border-[#211F1A] flex items-center justify-center">
              <Layers size={22} className="text-[#D6BE7A]" />
            </div>
            <p className="text-sm text-[#F7EBDD] mb-1">Couldn’t load projects</p>
            <p className="text-[11px] text-[#9B9282] mb-6 font-mono">{fetchError}</p>
            <button
              onClick={fetchProjects}
              className="inline-flex items-center gap-2 bg-[#171511] border border-[#211F1A] text-[#F7EBDD] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#3B372F] transition-colors"
            >
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          // Two sub-flavours: filtered-to-empty vs genuinely empty. The
          // CTA differs — clearing filters fixes the first; only "create"
          // helps the second.
          (() => {
            return (
              <div className="text-center py-32">
                <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-[#171511] border border-[#211F1A] flex items-center justify-center">
                  <Layers size={22} className="text-[#6E685B]" />
                </div>
                {isFiltered ? (
                  <>
                    <p className="text-sm text-[#F7EBDD] mb-1">No matches</p>
                    <p className="text-[11px] text-[#9B9282] mb-6">
                      {projects.length} project{projects.length !== 1 ? 's' : ''} hidden by the current filter or search.
                    </p>
                    <button
                      onClick={() => setFilters({ ...DEFAULT_PROJECT_FILTERS, tags: new Set() })}
                      className="inline-flex items-center gap-2 bg-[#171511] border border-[#211F1A] text-[#F7EBDD] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#3B372F] transition-colors"
                    >
                      Clear filters
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-[#F7EBDD] mb-1">No projects yet</p>
                    <p className="text-[11px] text-[#9B9282] mb-6">Create a project to group references, stems and versions</p>
                    <button
                      onClick={() => setCreateOpen(true)}
                      className="inline-flex items-center gap-2 bg-[#171511] border border-[#211F1A] text-[#F7EBDD] px-4 py-2 rounded-md text-[12px] font-medium hover:border-[#3B372F] disabled:opacity-40 transition-colors"
                    >
                      <Plus size={12} />
                      Create first project
                    </button>
                  </>
                )}
              </div>
            );
          })()
        ) : (
          <>
          {/* Recently opened — quick-access row before the main grid. Only shows
              when not searching/filtering and there are genuine recents. */}
          {!isFiltered && recentProjects.length > 0 && (
            <div className="mb-6">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6E685B] mb-3 flex items-center gap-2">
                <Clock size={10} /> Recently opened
              </p>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                {recentProjects.map((p) => (
                  <Link key={p.id} href={`/projects/${p.id}`} onClick={() => trackRecentOpen(p.id)}
                    className="shrink-0 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[#2B2821] bg-[#171511] hover:border-[#3B372F] hover:bg-[#211F1A] transition-colors min-w-[180px] max-w-[240px]">
                    <div className="w-8 h-8 rounded-md overflow-hidden bg-[#090907] shrink-0">
                      {p.cover_url || p.preview_covers?.[0] ? <img src={p.cover_url ?? p.preview_covers?.[0]} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[#6E685B]"><Music size={12} /></div>}
                    </div>
                    <span className="text-[11px] font-medium text-[#F7EBDD] truncate">{p.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((project) => {
              const updatedAt = project.updated_at ? new Date(project.updated_at) : null;
              const relativeTime = updatedAt ? relativeDate(updatedAt) : null;

              return (
                <MediaCard
                  key={project.id}
                  title={project.name}
                  href={`/projects/${project.id}`}
                  onOpen={() => trackRecentOpen(project.id)}
                  coverUrl={project.cover_url}
                  previewCovers={project.preview_covers}
                  fallbackIcon={<Music size={28} />}
                  pinned={project.pinned}
                  onTogglePin={(e) => togglePin(project, e)}
                  pinBusy={togglingPin === project.id}
                  optionsMenu={
                    <ProjectOptionsMenu project={project} onChanged={refreshProjectsAndFolders} onDeleted={fetchProjects} />
                  }
                  meta={
                    <>
                      <span>{project.track_count || 0} track{project.track_count === 1 ? '' : 's'}</span>
                      {relativeTime && (
                        <>
                          <span className="text-[#3B372F]">·</span>
                          <span className="inline-flex items-center gap-1"><Clock size={8} /> {relativeTime}</span>
                        </>
                      )}
                      {(project.tags?.length ?? 0) > 0 && (
                        <>
                          <span className="text-[#3B372F]">·</span>
                          <span className="truncate">{project.tags!.slice(0, 2).map((t) => t.tag).join(' / ')}</span>
                        </>
                      )}
                    </>
                  }
                />
              );
            })}
          </div>
          </>
        )}
      </PageContainer>
      {createOpen && (
        <CreateProjectModal
          kind="project"
          onClose={() => setCreateOpen(false)}
          onSuccess={(project, flow) => {
            setCreateOpen(false);
            fetchProjects();
            router.push(`/projects/${project.id}${flow === 'empty' ? '' : `?start=${flow}`}`);
          }}
        />
      )}
    </DashboardLayout>
  );
}
