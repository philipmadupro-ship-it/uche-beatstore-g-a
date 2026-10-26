/**
 * `/shared/<project>` — one shared project (LABEL-21, W4). The external
 * member sees THE PROJECT: its songs and recordings, the artist's name, and
 * what their role may do — never the org's other screens (07 §1). Authorised
 * here with `requireExternalProject` (a live membership of this project,
 * read on this request): anything else — another project, a removed or
 * expired membership, a stranger — is a real 404.
 */
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { SharedProjectView } from '@/components/labelos/SharedProjectView';
import { requireExternalProject } from '@/lib/auth/org-access';
import { loadSharedProject } from '@/lib/labelos/shared-project-store';

export const dynamic = 'force-dynamic';

export default async function SharedProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const access = await requireExternalProject({ projectId });
  if (!access.ok) notFound();
  const view = await loadSharedProject(access, projectId);
  if (!view) notFound();
  return (
    <PageContainer>
      <SharedProjectView view={view} />
    </PageContainer>
  );
}
