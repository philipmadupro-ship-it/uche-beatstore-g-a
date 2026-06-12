'use client';

import { useState } from 'react';
import { FolderPlus, Library, UploadCloud } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import { CONTENT_BUCKET_OPTIONS, type ContentBucketTag } from '@/lib/types/tags';

type CollectionKind = 'project' | 'playlist';
type StartFlow = 'library' | 'upload' | 'empty';

type CreatedCollection = {
  id: string;
  name?: string;
};

interface CreateProjectModalProps {
  kind?: CollectionKind;
  onClose: () => void;
  onSuccess: (collection: CreatedCollection, flow: StartFlow) => void;
}

const COPY: Record<CollectionKind, { title: string; description: string; label: string; placeholder: string; successKey: string }> = {
  project: {
    title: 'New project',
    description: 'Create a cover-first workspace, tag what it contains, then start from Library or Upload.',
    label: 'Project title',
    placeholder: 'untitled project',
    successKey: 'project',
  },
  playlist: {
    title: 'New playlist',
    description: 'Create a curated set, tag the pocket it belongs to, then add tracks from your Library.',
    label: 'Playlist title',
    placeholder: 'late night sends',
    successKey: 'playlist',
  },
};

const FLOW_OPTIONS: Record<CollectionKind, { value: StartFlow; label: string; description: string; icon: typeof Library }[]> = {
  project: [
    { value: 'library', label: 'From Library', description: 'Pick existing tracks right away.', icon: Library },
    { value: 'upload', label: 'Upload', description: 'Drop new audio into this project.', icon: UploadCloud },
    { value: 'empty', label: 'Empty shell', description: 'Set the cover and details first.', icon: FolderPlus },
  ],
  playlist: [
    { value: 'library', label: 'From Library', description: 'Pick existing tracks right away.', icon: Library },
    { value: 'empty', label: 'Empty set', description: 'Name and cover it first.', icon: FolderPlus },
  ],
};

export function CreateProjectModal({ kind = 'project', onClose, onSuccess }: CreateProjectModalProps) {
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [selectedBuckets, setSelectedBuckets] = useState<Set<ContentBucketTag>>(new Set());
  const [flow, setFlow] = useState<StartFlow>('library');

  const copy = COPY[kind];
  const endpoint = kind === 'project' ? '/api/projects' : '/api/playlists';

  const toggleBucket = (bucket: ContentBucketTag) => {
    setSelectedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  };

  const saveBuckets = async (id: string) => {
    if (selectedBuckets.size === 0) return;
    await Promise.all(
      [...selectedBuckets].map((tag) =>
        fetch(`${endpoint}/${id}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag, category: 'content_type' }),
        }),
      ),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(title.trim() ? { name: title.trim() } : {}),
      });

      const data = await res.json().catch(() => ({}));
      const collection = kind === 'project' ? data.project : data.playlist;
      if (!res.ok || !collection?.id) {
        throw new Error(data?.error || `Could not create ${copy.successKey}`);
      }

      await saveBuckets(collection.id);
      onSuccess(collection, flow);
    } catch (err) {
      console.error(`Create ${kind} error:`, err);
      toast.error(`Failed to create ${copy.successKey}`, err instanceof Error ? err.message : 'Try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={copy.title}
      description={copy.description}
      icon={<FolderPlus size={18} aria-hidden="true" />}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <Field
          autoFocus
          type="text"
          label={copy.label}
          helperText="Leave blank to use the next untitled name."
          placeholder={copy.placeholder}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div>
          <p className="ml-1 mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-readable)]">
            What belongs here?
          </p>
          <div className="flex flex-wrap gap-2">
            {CONTENT_BUCKET_OPTIONS.map((bucket) => {
              const active = selectedBuckets.has(bucket);
              return (
                <button
                  key={bucket}
                  type="button"
                  onClick={() => toggleBucket(bucket)}
                  className={cn(
                    'rounded-full border px-3 py-2 text-[11px] font-medium transition-all',
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-[#090907]'
                      : 'border-[var(--border)] bg-[var(--bg-page)] text-[var(--text-readable)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]',
                  )}
                >
                  {bucket}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="ml-1 mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-readable)]">
            Start with
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FLOW_OPTIONS[kind].map((option) => {
              const Icon = option.icon;
              const active = flow === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFlow(option.value)}
                  className={cn(
                    'flex min-h-[76px] items-start gap-3 rounded-xl border p-3 text-left transition-all',
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]'
                      : 'border-[var(--border)] bg-[var(--bg-page)] text-[var(--text-readable)] hover:border-[var(--border-hover)]',
                  )}
                >
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-current/20">
                    <Icon size={15} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-[var(--text-primary)]">{option.label}</span>
                    <span className="mt-1 block text-[11px] leading-4">{option.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Button
          loading={loading}
          type="submit"
          variant="accent"
          className="w-full"
        >
          {loading ? 'Creating' : `Create ${copy.successKey}`}
        </Button>
      </form>
    </Modal>
  );
}
