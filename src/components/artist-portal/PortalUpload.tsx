'use client';

/**
 * "Send a file" in the portal (PORTAL-UP, mig 191): shown only for projects
 * whose link the producer opened for uploads. Up to 4 MB goes through the
 * app; larger files PUT straight to private storage on a presigned URL and
 * are then registered. The server decides everything — this only picks the
 * route and reports the answer.
 */

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { MAX_DIRECT_UPLOAD_BYTES } from '@/lib/projects/assets';
import type { PortalFile } from '@/lib/artist-portal/view';

export function PortalUpload({
  token,
  projects,
  initialProjectId,
  headers,
  producerName,
  onUploaded,
}: {
  token: string;
  /** Only the projects with uploads on. */
  projects: Array<{ id: string; name: string }>;
  initialProjectId: string | null;
  headers: () => Record<string, string>;
  producerName: string;
  onUploaded: (file: PortalFile) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState<string>(
    initialProjectId && projects.some((p) => p.id === initialProjectId) ? initialProjectId : projects[0]?.id ?? '',
  );
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'done' | 'error'; text: string }>({ kind: 'idle', text: '' });
  if (projects.length === 0) return null;

  const base = `/api/portal/${encodeURIComponent(token)}/files`;

  const send = async (file: File): Promise<PortalFile> => {
    if (file.size <= MAX_DIRECT_UPLOAD_BYTES) {
      const form = new FormData();
      form.set('file', file);
      form.set('project_id', projectId);
      const res = await fetch(base, { method: 'POST', headers: headers(), body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Upload failed');
      return body.file as PortalFile;
    }
    const pre = await fetch(`${base}/presign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers() },
      body: JSON.stringify({ project_id: projectId, file_name: file.name, size_bytes: file.size }),
    });
    const signed = await pre.json().catch(() => ({}));
    if (!pre.ok) throw new Error(signed.error ?? 'Could not start the upload');
    const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'content-type': signed.contentType }, body: file });
    if (!put.ok) throw new Error('The upload did not finish. Try again.');
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers() },
      body: JSON.stringify({ project_id: projectId, upload_id: signed.uploadId, file_name: file.name }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'Upload failed');
    return body.file as PortalFile;
  };

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0 || !projectId) return;
    let sent = 0;
    for (const file of files) {
      setStatus({ kind: 'busy', text: `Sending ${file.name}…` });
      try {
        onUploaded(await send(file));
        sent += 1;
      } catch (err) {
        setStatus({ kind: 'error', text: `${file.name}: ${err instanceof Error ? err.message : 'Upload failed'}` });
        if (inputRef.current) inputRef.current.value = '';
        return;
      }
    }
    if (inputRef.current) inputRef.current.value = '';
    setStatus({ kind: 'done', text: `Sent ${sent} file${sent === 1 ? '' : 's'} to ${producerName || 'your producer'}.` });
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="portal-upload">
      {projects.length > 1 && (
        <Dropdown
          value={projectId}
          onChange={(v) => setProjectId(v)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          aria-label="Project to send to"
          menuWidth={240}
        />
      )}
      <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white/80 hover:border-white/20 hover:bg-white/[0.10] ${status.kind === 'busy' ? 'pointer-events-none opacity-40' : ''}`}>
        <Upload size={14} aria-hidden="true" />
        Send a file{projects.length === 1 ? ` to ${projects[0].name}` : ''}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          data-testid="portal-upload-input"
          disabled={status.kind === 'busy'}
          onChange={(e) => void onFiles(e.target.files)}
        />
      </label>
      {status.text && (
        <p role="status" className={`text-xs ${status.kind === 'error' ? 'text-[#ff8b73]' : 'text-white/50'}`}>{status.text}</p>
      )}
    </div>
  );
}
