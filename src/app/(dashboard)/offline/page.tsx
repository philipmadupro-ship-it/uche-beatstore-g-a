'use client';

import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { CloudOff, Trash2, Music2, Wifi, WifiOff } from 'lucide-react';
import { listCached, removeCached, clearAllCached, OfflineMeta } from '@/lib/offline/audio-cache';
import { confirmToast } from '@/hooks/useToast';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

function formatMB(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function OfflinePage() {
  const [items, setItems] = useState<OfflineMeta[]>([]);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      setItems(await listCached());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    return () => {
      window.removeEventListener('online', upd);
      window.removeEventListener('offline', upd);
    };
  }, []);

  const totalBytes = items.reduce((sum, m) => sum + m.size, 0);

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          eyebrow="Available offline"
          title="Offline"
          description="Tracks cached locally for sessions without a reliable connection."
          meta={`${items.length} track${items.length === 1 ? '' : 's'} · ${formatMB(totalBytes)}`}
          actions={
            <div className="flex items-center gap-3">
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[10px] font-mono uppercase tracking-wider ${
                online
                  ? 'bg-[#0e1f17] border-[#6DC6A4]/30 text-[#6DC6A4]'
                  : 'bg-[#1f0a0a] border-red-900/50 text-red-300'
              }`}
            >
              {online ? <Wifi size={10} /> : <WifiOff size={10} />}
              {online ? 'Online' : 'Offline'}
            </div>
            {items.length > 0 && (
              <Button
                onClick={async () => {
                  const ok = await confirmToast(
                    'Clear all cached tracks?',
                    'You\u2019ll need to re-download tracks for offline playback.',
                    { confirmLabel: 'Clear', cancelLabel: 'Keep', danger: true },
                  );
                  if (!ok) return;
                  await clearAllCached();
                  refresh();
                }}
                variant="danger"
                size="sm"
                leadingIcon={<Trash2 size={11} aria-hidden="true" />}
              >
                Clear all
              </Button>
            )}
          </div>
          }
        />

        {!loading && items.length === 0 ? (
          <EmptyState
            icon={<CloudOff size={28} aria-hidden="true" />}
            title="Nothing saved offline yet"
            description='Tap "Save offline" on any track to cache it locally.'
            className="border-dashed py-32"
          />
        ) : (
          <>
            <Card className="overflow-hidden">
              {items.map((m) => (
                <div
                  key={m.id}
                  className="grid grid-cols-[40px_1fr_88px_40px] items-center gap-4 border-b border-[var(--border)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--bg-hover)] sm:grid-cols-[40px_1fr_120px_120px_60px]"
                >
                  <div className="flex size-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-page)]">
                    <Music2 size={12} className="text-[#F3E6D1]" />
                  </div>
                  <p className="truncate text-[12px] text-[var(--text-primary)]">{m.title || m.id}</p>
                  <p className="font-mono text-[10px] text-[var(--text-readable)]">{formatMB(m.size)}</p>
                  <p className="hidden font-mono text-[10px] text-[var(--text-readable)] sm:block">
                    {new Date(m.cached_at).toLocaleDateString()}
                  </p>
                  <Button
                    onClick={async () => {
                      await removeCached(m.id);
                      refresh();
                    }}
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label={`Remove ${m.title || m.id} from offline cache`}
                    className="justify-self-end"
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </Card>
          </>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
