/**
 * `/o/<slug>/artists` and the artist workspace under it (LABEL-74). The list
 * page is a client component, so the gate lives here: a viewer the role view
 * does not give the Artists page (no `catalog.read`, a producer org) gets a real
 * 404 rather than an empty shell that fetches and fails. Object access on a
 * single artist is still the page's own `requireObjectAccess`.
 */
import { notFound } from 'next/navigation';
import { orgShellFor } from '@/lib/auth/org-access';
import { pageAllowed, viewInputOf } from '@/lib/labelos/role-view';

export const dynamic = 'force-dynamic';

export default async function ArtistsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell || !pageAllowed('artists', viewInputOf(shell))) notFound();
  return <>{children}</>;
}
