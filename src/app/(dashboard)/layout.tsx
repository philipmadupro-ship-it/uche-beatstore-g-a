import { TopBar } from '@/components/nav/TopBar';
import { NavPanel } from '@/components/nav/NavPanel';
import { DashboardShell } from './DashboardShell';
import { PlayerBar } from '@/components/player/PlayerBar';
import { MediaSessionBridge } from '@/components/player/MediaSessionBridge';
import { UploadsTray } from '@/components/upload/UploadsTray';
import { StemWarmup } from '@/components/system/StemWarmup';
import { WidgetErrorBoundary } from '@/components/system/WidgetErrorBoundary';

/**
 * Each always-on widget is isolated. React tears down the whole tree when a
 * component throws, so without these boundaries a crash in any accessory widget
 * blanks every dashboard route — which is exactly what a malformed persisted
 * upload used to do. `children` is deliberately NOT wrapped: if the page itself
 * fails, the user should see Next's error UI rather than an empty shell.
 */
export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <WidgetErrorBoundary name="TopBar"><TopBar /></WidgetErrorBoundary>
      <WidgetErrorBoundary name="NavPanel"><NavPanel /></WidgetErrorBoundary>
      <DashboardShell>{children}</DashboardShell>
      <WidgetErrorBoundary name="PlayerBar"><PlayerBar /></WidgetErrorBoundary>
      <WidgetErrorBoundary name="MediaSessionBridge"><MediaSessionBridge /></WidgetErrorBoundary>
      <WidgetErrorBoundary name="UploadsTray"><UploadsTray /></WidgetErrorBoundary>
      <WidgetErrorBoundary name="StemWarmup"><StemWarmup /></WidgetErrorBoundary>
    </div>
  );
}
