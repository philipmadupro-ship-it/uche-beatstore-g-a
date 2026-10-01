import type { Workspace } from '@/lib/artists/workspace-load';

/** GET /api/contacts/[id]/workspace, as the client receives it. */
export type WorkspaceResponse =
  | { schemaReady: false; workspaceMode: false }
  | (Omit<Workspace, 'portal'> & {
      schemaReady: true;
      portal: (NonNullable<Workspace['portal']> & { url: string }) | null;
    });

export type ReadyWorkspace = Extract<WorkspaceResponse, { schemaReady: true }>;

export async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as T;
}
