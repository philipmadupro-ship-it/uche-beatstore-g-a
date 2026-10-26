/**
 * Browser calls to the release export and the calendar link routes
 * (LABEL-34). Each answers a tagged result instead of throwing, so a screen
 * can show the server's own words ("Forbidden") rather than a generic failure.
 */
export type ExportFormat = 'csv' | 'json';
export type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export const exportUrl = (orgId: string, releaseId: string, format: ExportFormat) =>
  `/api/org/${orgId}/releases/${releaseId}/export?format=${format}`;

/** The file name the server chose, else a fallback. Never trusted beyond a bare file name. */
export function filenameFrom(contentDisposition: string | null, fallback: string): string {
  const hit = /filename="([^"\\/\r\n]+)"/.exec(contentDisposition ?? '');
  return hit ? hit[1] : fallback;
}

async function failure(res: Response): Promise<{ ok: false; status: number; error: string }> {
  const json = (await res.json().catch(() => ({}))) as { error?: unknown };
  return { ok: false, status: res.status, error: typeof json.error === 'string' && json.error ? json.error : `HTTP ${res.status}` };
}

/** Fetch the export (the session cookie authorises it) and hand the browser the file. */
export async function downloadReleaseExport(orgId: string, releaseId: string, format: ExportFormat): Promise<Result<{ filename: string }>> {
  try {
    const res = await fetch(exportUrl(orgId, releaseId, format));
    if (!res.ok) return await failure(res);
    const filename = filenameFrom(res.headers.get('content-disposition'), `release-metadata.${format}`);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(href);
    return { ok: true, filename };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

export type CalendarLink = { active: false } | { active: true; path: string };

async function feedCall(method: 'GET' | 'POST' | 'DELETE', orgId: string): Promise<Result<CalendarLink>> {
  try {
    const res = await fetch(`/api/org/${orgId}/calendar/feed`, { method });
    if (!res.ok) return await failure(res);
    return { ok: true, ...((await res.json()) as CalendarLink) };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server' };
  }
}

export const fetchCalendarLink = (orgId: string) => feedCall('GET', orgId);
export const issueCalendarLink = (orgId: string) => feedCall('POST', orgId);
export const revokeCalendarLink = (orgId: string) => feedCall('DELETE', orgId);
