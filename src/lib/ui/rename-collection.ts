import { toast } from '@/hooks/useToast';

/**
 * Rename a project or playlist from wherever it is shown.
 *
 * Shared because the grid card, the detail header and the ⋯ menu all needed
 * the same three lines, and when each kept its own copy they drifted: one
 * reported success before checking the response, another closed its editor on
 * a 400. Returning a boolean lets an inline field stay open on failure with
 * the user's typing intact.
 */
export async function renameCollection(
  kind: 'projects' | 'playlists',
  id: string,
  next: string,
  onDone?: () => void,
): Promise<boolean> {
  const name = next.trim();
  if (!name) return false;
  try {
    const res = await fetch(`/api/${kind}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error('Rename failed', j?.error || `HTTP ${res.status}`);
      return false;
    }
    onDone?.();
    return true;
  } catch (err) {
    toast.error('Rename failed', err instanceof Error ? err.message : 'Network error');
    return false;
  }
}
