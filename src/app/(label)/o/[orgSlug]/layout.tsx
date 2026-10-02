/**
 * The Label OS org shell, `/o/<slug>/…` (LABEL-09, 07 §1). Physically apart
 * from (dashboard): the proxy admits only signed-in users with some org
 * membership (and 404s the whole namespace while LABEL_OS_ENABLED is off);
 * this layout then resolves WHICH org and the viewer's standing in it, and
 * answers 404 to anyone who is not a member — the same answer as an org that
 * does not exist.
 *
 * Mounts PlayerBar (CLAUDE.md player rule: any page that plays through
 * `usePlayer` must sit under a layout that mounts it). It renders per
 * request, never prerendered: the org depends on the session.
 */
import { notFound } from 'next/navigation';
import { TopBar } from '@/components/nav/TopBar';
import { PlayerBar } from '@/components/player/PlayerBar';
import { MediaSessionBridge } from '@/components/player/MediaSessionBridge';
import { WidgetErrorBoundary } from '@/components/system/WidgetErrorBoundary';
import { LabelOsFlagProvider } from '@/components/labelos/LabelOsFlag';
import { OrgShellProvider } from '@/components/labelos/OrgShellContext';
import { ArtworkThemeProvider } from '@/components/providers/ArtworkThemeProvider';
import { orgShellFor } from '@/lib/auth/org-access';
import { isLabelOsEnabled } from '@/lib/labelos/flag';

export const dynamic = 'force-dynamic';

export default async function OrgShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  // The proxy already 404s /o/* with the flag off; this is belt and braces.
  if (!isLabelOsEnabled()) notFound();
  const { orgSlug } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell) notFound();

  const body = (
    <div className="min-h-screen bg-[#090907]">
      <WidgetErrorBoundary name="TopBar"><TopBar /></WidgetErrorBoundary>
      <main className="pt-14 pb-28 min-h-screen">{children}</main>
      <WidgetErrorBoundary name="PlayerBar"><PlayerBar /></WidgetErrorBoundary>
      <WidgetErrorBoundary name="MediaSessionBridge"><MediaSessionBridge /></WidgetErrorBoundary>
    </div>
  );

  return (
    <LabelOsFlagProvider enabled>
      <OrgShellProvider value={shell}>
        {/* A member who is not the producer cannot read the producer's
            profile or tag colours (/api/profile, /api/tags/colors are
            producer-only); a supplied theme stops the artwork hooks fetching
            them, as on the public pages. */}
        {shell.viewerIsProducer ? body : <ArtworkThemeProvider theme={null}>{body}</ArtworkThemeProvider>}
      </OrgShellProvider>
    </LabelOsFlagProvider>
  );
}
