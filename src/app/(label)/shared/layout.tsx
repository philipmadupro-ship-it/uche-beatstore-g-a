/**
 * The shell of `/shared/*` (LABEL-21, 07 §1 "Shared with me"): where a person
 * admitted to ONE project of someone else's org works. It has no org chrome —
 * no org switcher of THEIR org here, no members, artists or settings — only a
 * slim bar back to the list of what was shared, the persistent player and the
 * uploads tray. Physically apart from `/o/<slug>`, so no org screen can be
 * reached from it by accident.
 *
 * The proxy admits only a signed-in user with some org or project membership
 * (and 404s the namespace while LABEL_OS_ENABLED is off); each page then asks
 * for ITS project (`requireExternalProject`) and answers 404 to anyone who is
 * not a live member of it. Renders per request, never prerendered.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlayerBar } from '@/components/player/PlayerBar';
import { MediaSessionBridge } from '@/components/player/MediaSessionBridge';
import { WidgetErrorBoundary } from '@/components/system/WidgetErrorBoundary';
import { UploadsTray } from '@/components/upload/UploadsTray';
import { LabelOsFlagProvider } from '@/components/labelos/LabelOsFlag';
import { ArtworkThemeProvider } from '@/components/providers/ArtworkThemeProvider';
import { OrgSwitcher } from '@/components/nav/OrgSwitcher';
import { isLabelOsEnabled } from '@/lib/labelos/flag';

export const dynamic = 'force-dynamic';

export default function SharedLayout({ children }: { children: React.ReactNode }) {
  if (!isLabelOsEnabled()) notFound();
  return (
    <LabelOsFlagProvider enabled>
      {/* A person here is not the producer: the artwork hooks must not fetch the producer's profile or tag colours. */}
      <ArtworkThemeProvider theme={null}>
        <div className="min-h-screen bg-[#090907]">
          <header className="fixed left-0 right-0 top-0 z-30 border-b border-white/10 bg-[#090907]/95 backdrop-blur-md">
            <div className="flex h-14 items-center gap-3 px-4 md:px-6">
              <Link href="/shared" className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60 transition-colors hover:text-white">
                Shared with me
              </Link>
              <div className="ml-auto">
                <WidgetErrorBoundary name="OrgSwitcher">
                  <OrgSwitcher />
                </WidgetErrorBoundary>
              </div>
            </div>
          </header>
          <main className="min-h-screen pb-28 pt-14">{children}</main>
          <WidgetErrorBoundary name="PlayerBar"><PlayerBar /></WidgetErrorBoundary>
          <WidgetErrorBoundary name="UploadsTray"><UploadsTray /></WidgetErrorBoundary>
          <WidgetErrorBoundary name="MediaSessionBridge"><MediaSessionBridge /></WidgetErrorBoundary>
        </div>
      </ArtworkThemeProvider>
    </LabelOsFlagProvider>
  );
}
