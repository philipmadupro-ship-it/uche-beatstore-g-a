'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Settings as SettingsIcon, Loader2, LogOut, Shield, User, ArrowRight, FileText, Trash2 } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { toast, confirmToast } from '@/hooks/useToast';
import { ErasureRequestSchema } from '@/lib/contracts';
import { DefaultArtworkCard } from '@/components/settings/DefaultArtworkCard';
import { TagColorsCard } from '@/components/settings/TagColorsCard';
import { DesktopNotificationsRow } from '@/components/settings/DesktopNotificationsRow';
import { OrgsSettingsCard } from '@/components/labelos/OrgsSettingsCard';

interface Prefs {
  lossless_exports: boolean;
  auto_tagging: boolean;
}

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>({ lossless_exports: true, auto_tagging: false });
  const [eraseEmail, setEraseEmail] = useState('');
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const profileRes = await fetch('/api/profile');
        if (profileRes.ok) {
          const j = await profileRes.json();
          const p = j.profile;
          if (p) {
            setPrefs({
              lossless_exports: p.lossless_exports ?? true,
              auto_tagging: p.auto_tagging ?? false,
            });
          }
        }
      } catch {/* silent */}
    })();
  }, []);

  /**
   * Optimistic, but it rolls back and says so.
   *
   * This used to `.catch(() => undefined)` without checking `res.ok`, so a
   * rejected save left the switch sitting in its new position: the producer
   * saw "Lossless exports: on" and got MP3s.
   */
  const savePrefs = async (next: Prefs) => {
    const previous = prefs;
    setPrefs(next);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setPrefs(previous);
      toast.error('Preference not saved', err instanceof Error ? err.message : 'Try again');
    }
  };

  const handleErase = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = eraseEmail.trim();
    if (!ErasureRequestSchema.safeParse({ email }).success) {
      toast.error('Enter a valid buyer email');
      return;
    }
    const ok = await confirmToast(
      `Erase ${email}?`,
      'Their email and Stripe details are anonymised on sales, offers, delivery emails, their contact and comments, and their favourites, history, playlists, follows and carts are deleted. Sale amounts and dates are kept. This cannot be undone.',
      { confirmLabel: 'Erase data', cancelLabel: 'Cancel', danger: true },
    );
    if (!ok) return;
    setErasing(true);
    try {
      const res = await fetch('/api/privacy/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erasure failed');
      const total = typeof data.total === 'number' ? data.total : 0;
      toast.success(total > 0 ? `Erased buyer data on ${total} record${total === 1 ? '' : 's'}` : 'No records found for that email');
      setEraseEmail('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erasure failed');
    } finally {
      setErasing(false);
    }
  };

  return (
    <DashboardLayout>
      <PageContainer className="pb-32">
        <PageHeader
          eyebrow="Workspace"
          title="Settings"
          description="Workspace access, preferences, and account controls."
          meta={user?.email}
          actions={
            <Button
              onClick={() => signOut()}
              variant="secondary"
              leadingIcon={<LogOut size={13} aria-hidden="true" />}
            >
              Sign out
            </Button>
          }
        />

        <div className="mx-auto max-w-[900px] space-y-12">
          
          {/* Creator Profile — link card to canonical /profile page */}
          <section>
            <Link
              href="/profile"
              className="group block"
            >
              <Card interactive className="flex items-center gap-5 p-6">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border-hover)] bg-white/[0.05] transition-colors group-hover:border-[var(--accent)]/30">
                  <User size={20} className="text-[var(--text-readable)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-readable)]">Creator identity</p>
                  <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Creator Profile</h2>
                  <p className="mt-0.5 text-[11px] text-[var(--text-readable)]">Bio, hero image, licensing tiers, social links, and license agreement.</p>
                </div>
                <ArrowRight size={16} className="shrink-0 text-white/40 transition-colors group-hover:text-[var(--text-primary)]" />
              </Card>
            </Link>
          </section>

          {/* License Builder */}
          <section>
            {/* Straight to the canonical builder. This used to point at
                /settings/licenses, a page whose entire content is a notice
                saying the builder moved to the store editor — so reaching it
                cost two navigations through a tombstone. */}
            <Link
              href="/store-editor#licenses"
              className="group block"
            >
              <Card interactive className="flex items-center gap-5 p-6">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border-hover)] bg-white/[0.05] transition-colors group-hover:border-[var(--accent)]/30">
                  <FileText size={20} className="text-[var(--text-readable)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-readable)]">Storefront</p>
                  <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">License Builder</h2>
                  <p className="mt-0.5 text-[11px] text-[var(--text-readable)]">Create up to 4 license tiers with custom pricing, rights, and file delivery.</p>
                </div>
                <ArrowRight size={16} className="shrink-0 text-white/40 transition-colors group-hover:text-[var(--text-primary)]" />
              </Card>
            </Link>
          </section>

          {/* Label OS organizations — nothing at all while the flag is off. */}
          <OrgsSettingsCard />

          {/* Default artwork + brand palette */}
          <DefaultArtworkCard />

          {/* Tag colours — what the generated artwork is keyed to */}
          <TagColorsCard />

          {/* Preferences */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <SettingsIcon size={14} className="text-white/40" />
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-white">Preferences</h2>
            </div>
            <Card className="divide-y divide-white/10 overflow-hidden">
              <ToggleRow
                title="Lossless exports"
                description="Prefer WAV/AIFF for shared links"
                on={prefs.lossless_exports}
                onToggle={(v) => savePrefs({ ...prefs, lossless_exports: v })}
              />
              <ToggleRow
                title="Auto-tagging"
                description="AI analysis tags on upload"
                on={prefs.auto_tagging}
                onToggle={(v) => savePrefs({ ...prefs, auto_tagging: v })}
              />
              {/* Per-device, not per-account: OS permission is granted per
                  browser, so this one does not go through savePrefs. */}
              <DesktopNotificationsRow />
            </Card>
          </section>

          {/* Buyer privacy — GDPR/CCPA erasure */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Shield size={14} className="text-white/40" />
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-white">Buyer privacy</h2>
            </div>
            <Card className="p-6">
              <p className="text-[13px] text-white/40 mb-4 max-w-prose">
                Honour a buyer&apos;s data-deletion request. Their email is anonymised on sales,
                offers, delivery emails, their contact and comments; their favourites, listening
                history, playlists, follows and abandoned carts are deleted. Sale amounts and dates
                are kept for your accounting.
              </p>
              <form onSubmit={handleErase} className="flex flex-col sm:flex-row gap-3 sm:items-end">
                <Field
                  label="Buyer email"
                  type="email"
                  value={eraseEmail}
                  onChange={(e) => setEraseEmail(e.target.value)}
                  placeholder="buyer@example.com"
                  className="flex-1"
                />
                <Button type="submit" variant="secondary" disabled={erasing || !eraseEmail.trim()}>
                  {erasing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Erase buyer data
                </Button>
              </form>
            </Card>
          </section>
        </div>
      </PageContainer>

    </DashboardLayout>
  );
}

function ToggleRow({ title, description, on, onToggle }: { title: string; description: string; on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="flex w-full cursor-pointer items-center justify-between bg-white/[0.02] px-6 py-4 text-left transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 focus-visible:ring-inset"
      onClick={() => onToggle(!on)}
    >
      <div>
        <p className="text-[11px] font-medium text-white">{title}</p>
        <p className="mt-0.5 text-[10px] text-[var(--text-readable)]">{description}</p>
      </div>
      {/* The knob was `bg-white` on a `bg-white` track when on — a solid white
          pill with no visible thumb, so the only way to read the switch was to
          remember which side it started on. */}
      <div className={`w-9 h-5 rounded-full relative transition-colors ${on ? 'bg-[#6DC6A4]' : 'bg-white/[0.05] border border-white/20'}`}>
        <div className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${on ? 'right-[3px] bg-[#090907]' : 'left-[3px] bg-white/40'}`} />
      </div>
    </button>
  );
}
