'use client';

/**
 * "Start workspace" for a contact that is not an artist yet: create a project
 * for them, or link one that exists. Either puts them in workspace mode
 * (linked to at least one project); nothing is emailed until the producer
 * shares the project.
 */

import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { jsonOrThrow } from './types';

export function StartWorkspace({ contactId, contactName, onStarted, onCancel }: {
  contactId: string;
  contactName: string;
  onStarted: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    fetch('/api/projects').then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d) => setProjects(((d.projects ?? []) as Array<{ id: string; name: string }>).map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => {});
  }, []);

  const link = async (projectId: string) => {
    await jsonOrThrow(await fetch(`/api/projects/${projectId}/contacts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: contactId }),
    }));
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(`${contactName} is now an artist workspace`);
      onStarted();
    } catch (err) {
      toast.error('Could not start the workspace', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="start-ws" className="rounded-xl border border-white/10 bg-[#0D0D0A] p-5" data-testid="start-workspace">
      <h2 id="start-ws" className="flex items-center gap-2 text-[13px] text-white/80"><Layers size={13} aria-hidden="true" /> Start a workspace for {contactName}</h2>
      <p className="mt-1 text-[12px] text-white/40">A workspace links {contactName} to projects and gives them one private portal. Nothing is sent until you share.</p>
      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const { project } = await jsonOrThrow<{ project: { id: string } }>(await fetch('/api/projects', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() || `${contactName} — New project` }),
            }));
            await link(project.id);
          });
        }}
      >
        <label className="min-w-[200px] flex-1">
          <span className="sr-only">New project name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${contactName} — New project`}
            className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[12px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
          />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40">
          New project for {contactName}
        </button>
        {projects.length > 0 && (
          <Dropdown
            value=""
            onChange={(v) => { if (v) void run(() => link(v)); }}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="or link a project"
            aria-label="Link an existing project"
            disabled={busy}
            menuWidth={260}
          />
        )}
        <button type="button" onClick={onCancel} className="px-2 text-[11px] text-white/50 hover:text-white">Cancel</button>
      </form>
    </section>
  );
}
