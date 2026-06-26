'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { UserPlus, Settings as SettingsIcon, Loader2, LogOut, CheckCircle2, Shield, User, ArrowRight, FileText, Trash2 } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dropdown } from '@/components/ui/Dropdown';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { toast, confirmToast } from '@/hooks/useToast';
import { ErasureRequestSchema } from '@/lib/contracts';

interface TeamMember {
  user_id: string;
  role: 'owner' | 'admin' | 'collaborator';
  email: string;
  name: string;
}

interface Prefs {
  lossless_exports: boolean;
  auto_tagging: boolean;
}

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'collaborator'>('collaborator');
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({ lossless_exports: true, auto_tagging: false });
  const [eraseEmail, setEraseEmail] = useState('');
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [teamRes, profileRes] = await Promise.all([
          fetch('/api/team'),
          fetch('/api/profile'),
        ]);
        if (teamRes.ok) {
          const j = await teamRes.json();
          setTeam(j.members ?? []);
        }
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
      } catch {/* silent */} finally {
        setLoading(false);
      }
    })();
  }, []);

  const savePrefs = async (next: Prefs) => {
    setPrefs(next);
    await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => undefined);
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
      'Their email + Stripe details are permanently anonymised on all purchase records. Sale amounts and dates are kept. This cannot be undone.',
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
      const total = (data.licensePurchases ?? 0) + (data.projectAccessLinks ?? 0);
      toast.success(total > 0 ? `Erased buyer data on ${total} record${total === 1 ? '' : 's'}` : 'No purchase records found for that email');
      setEraseEmail('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erasure failed');
    } finally {
      setErasing(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (res.ok) {
        setSuccess(true);
        setInviteEmail('');
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
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
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border-hover)] bg-[#211F1A] transition-colors group-hover:border-[var(--accent)]/30">
                  <User size={20} className="text-[var(--text-readable)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-readable)]">Creator identity</p>
                  <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Creator Profile</h2>
                  <p className="mt-0.5 text-[11px] text-[var(--text-readable)]">Bio, hero image, licensing tiers, social links, and license agreement.</p>
                </div>
                <ArrowRight size={16} className="shrink-0 text-[#9B9282] transition-colors group-hover:text-[var(--text-primary)]" />
              </Card>
            </Link>
          </section>

          {/* License Builder */}
          <section>
            <Link
              href="/settings/licenses"
              className="group block"
            >
              <Card interactive className="flex items-center gap-5 p-6">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border-hover)] bg-[#211F1A] transition-colors group-hover:border-[var(--accent)]/30">
                  <FileText size={20} className="text-[var(--text-readable)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-readable)]">Storefront</p>
                  <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">License Builder</h2>
                  <p className="mt-0.5 text-[11px] text-[var(--text-readable)]">Create up to 4 license tiers with custom pricing, rights, and file delivery.</p>
                </div>
                <ArrowRight size={16} className="shrink-0 text-[#9B9282] transition-colors group-hover:text-[var(--text-primary)]" />
              </Card>
            </Link>
          </section>

          {/* Team */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Shield size={14} className="text-[#9B9282]" />
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#F7EBDD]">Team members</h2>
            </div>
            {loading ? (
              <div className="py-12 flex justify-center"><Loader2 size={16} className="animate-spin text-[#837B6D]" /></div>
            ) : team.length === 0 ? (
              <EmptyState
                title="No team members yet"
                description="Invite collaborators below."
                className="py-10"
              />
            ) : (
              <Card className="divide-y divide-[#24211B] overflow-hidden">
                {team.map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between px-4 py-3 bg-[#171511]/50">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-[#1A1813] border border-[#211F1A] flex items-center justify-center text-[10px] font-medium text-[#D0C3AF]">
                        {m.name?.[0] || m.email[0]}
                      </div>
                      <div>
                        <p className="text-[12px] font-medium text-[#F7EBDD]">{m.name || m.email}</p>
                        {m.name && <p className="text-[10px] font-mono text-[#9B9282]">{m.email}</p>}
                      </div>
                    </div>
                    <span className={`text-[10px] font-mono uppercase tracking-wider ${m.role === 'owner' ? 'text-[#F3E6D1]' : 'text-[#9B9282]'}`}>
                      {m.role}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </section>

          {/* Invite */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <UserPlus size={14} className="text-[#9B9282]" />
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#F7EBDD]">Invite collaborator</h2>
            </div>
            <Card>
              <form onSubmit={handleInvite} className="space-y-4 p-6">
              <Field
                required
                type="email"
                label="Email"
                placeholder="name@email.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-[var(--text-readable)]">Role</label>
                <Dropdown
                  value={inviteRole}
                  onChange={(value) => setInviteRole(value)}
                  options={[
                    { value: 'collaborator', label: 'Collaborator' },
                    { value: 'admin', label: 'Admin' },
                  ]}
                  aria-label="Invite role"
                  className="min-h-11 w-full rounded-xl border-[var(--border)] bg-[var(--bg-page)] px-4 py-3 text-xs text-[var(--text-primary)] focus:border-[var(--accent)]"
                />
              </div>
              <Button
                disabled={sending || success}
                type="submit"
                variant={success ? 'secondary' : 'primary'}
                className={success ? 'w-full border-green-500/20 bg-green-500/10 text-green-400' : 'w-full'}
                loading={sending}
                leadingIcon={success ? <CheckCircle2 size={13} aria-hidden="true" /> : <UserPlus size={13} aria-hidden="true" />}
              >
                {sending ? 'Sending...' : success ? 'Invite sent' : 'Send invite'}
              </Button>
              </form>
            </Card>
          </section>

          {/* Preferences */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <SettingsIcon size={14} className="text-[#9B9282]" />
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#F7EBDD]">Preferences</h2>
            </div>
            <Card className="divide-y divide-[#24211B] overflow-hidden">
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
            </Card>
          </section>

          {/* Buyer privacy — GDPR/CCPA erasure */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Shield size={14} className="text-[#9B9282]" />
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#F7EBDD]">Buyer privacy</h2>
            </div>
            <Card className="p-6">
              <p className="text-[13px] text-[#9B9282] mb-4 max-w-prose">
                Honour a buyer&apos;s data-deletion request. Their email and Stripe details are
                permanently anonymised across every purchase record; sale amounts and dates are
                kept for your accounting.
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
      className="flex w-full cursor-pointer items-center justify-between bg-[#171511]/50 px-6 py-4 text-left transition-colors hover:bg-[#171511] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 focus-visible:ring-inset"
      onClick={() => onToggle(!on)}
    >
      <div>
        <p className="text-[12px] font-medium text-[#F7EBDD]">{title}</p>
        <p className="mt-0.5 text-[10px] text-[var(--text-readable)]">{description}</p>
      </div>
      <div className={`w-9 h-5 rounded-full relative transition-colors ${on ? 'bg-[#E7D7BE]' : 'bg-[#211F1A] border border-[#3B372F]'}`}>
        <div className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${on ? 'right-[3px] bg-white' : 'left-[3px] bg-[#9B9282]'}`} />
      </div>
    </button>
  );
}
