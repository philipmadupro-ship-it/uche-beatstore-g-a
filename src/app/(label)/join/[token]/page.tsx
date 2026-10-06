'use client';

/**
 * /join/<token> — accept an org invitation (LABEL-08, W1).
 *
 * The page signs the invitee in itself (magic link or Google, the same
 * Supabase auth as /store/account), with the callback's `next` pointing back
 * here. It never goes through /login, which bounces a signed-in non-producer
 * to the buyer account (the LABEL-06 carried note). After Accept it links to
 * the org at /o/<slug>.
 *
 * Behind LABEL_OS_ENABLED (src/proxy.ts 404s it while off). Open to
 * signed-out visitors and non-members; the route does every check.
 *
 * Contrast (R-22): body copy is white/80 or --text-readable on the card;
 * the single solid-white button carries near-black text.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { describeGrant, joinStep, type InvitationPreview } from '@/lib/labelos/invitations';
import { PROJECT_ROLE_LABELS, isExternalProjectRole } from '@/lib/labelos/project-members';
import { ORG_FUNCTIONS, ROLES, type OrgFunction, type Role } from '@/lib/labelos/capabilities';

type Loaded =
  | { kind: 'loading' }
  | { kind: 'missing'; message: string; notFound: boolean }
  | { kind: 'preview'; preview: InvitationPreview }
  | { kind: 'joined'; name: string; slug: string | null; /** A project invitation (LABEL-21): where the one project opens. */ project: { name: string; href: string } | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function grantLabel(p: InvitationPreview): string {
  // A project invitation (LABEL-21): the §2.6 role, on that one project.
  if (p.project) return `${isExternalProjectRole(p.role) ? PROJECT_ROLE_LABELS[p.role] : p.role} · one project`;
  const role = ROLES.find((r) => r === p.role) as Role | undefined;
  if (!role) return p.role;
  const fns = p.functions.filter((f): f is OrgFunction => (ORG_FUNCTIONS as readonly string[]).includes(f));
  return describeGrant(role, fns);
}

async function callJoin(token: string, action: 'preview' | 'accept') {
  const res = await fetch('/api/org/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, action }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === 'string' ? params.token : '';
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [linkSent, setLinkSent] = useState(false);

  const returnTo = `/join/${encodeURIComponent(token)}`;
  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo)}`;

  const load = useCallback(async () => {
    try {
      const { status, body } = await callJoin(token, 'preview');
      if (status === 200) setLoaded({ kind: 'preview', preview: body as unknown as InvitationPreview });
      else
        setLoaded({
          kind: 'missing',
          message: typeof body.error === 'string' ? body.error : 'Could not read the invitation.',
          notFound: status === 404,
        });
    } catch {
      setLoaded({ kind: 'missing', message: 'Could not reach the server. Reload to try again.', notFound: false });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const { status, body } = await callJoin(token, 'accept');
      const org = body.org as { name?: string; slug?: string } | undefined;
      const project = body.project as { name?: string; href?: string } | undefined;
      if (status === 200 && org) {
        setLoaded({
          kind: 'joined',
          name: org.name ?? 'the organization',
          slug: org.slug ?? null,
          project: project?.href ? { name: project.name ?? 'the project', href: project.href } : null,
        });
      } else {
        setError(typeof body.error === 'string' ? body.error : 'Could not accept the invitation.');
        if (status !== 403) void load();
      }
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setError(null);
    const { error: oauthErr } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl() },
    });
    if (oauthErr) {
      setBusy(false);
      setError(oauthErr.message);
    }
  };

  const magicLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: otpErr } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl() },
    });
    setBusy(false);
    if (otpErr) setError(otpErr.message);
    else setLinkSent(true);
  };

  const signOut = async () => {
    setBusy(true);
    await createClient().auth.signOut();
    // A full load, so the proxy and the route see the cleared session.
    window.location.assign(returnTo);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090907] p-4 text-white">
      <div className="w-full max-w-sm rounded-[20px] border border-white/10 bg-[#0D0D0A] p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Invitation</p>
        <JoinBody
          loaded={loaded}
          busy={busy}
          email={email}
          linkSent={linkSent}
          onEmail={setEmail}
          onAccept={accept}
          onGoogle={google}
          onMagicLink={magicLink}
          onSignOut={signOut}
          onResetLink={() => {
            setLinkSent(false);
            setEmail('');
          }}
        />
        {error && (
          <div role="alert" className="mt-6 flex items-start gap-2 text-sm leading-5 text-[var(--error-text)]">
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}
      </div>
    </main>
  );
}

const PRIMARY =
  'flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-[#090907] transition-colors hover:bg-white/90 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0D0A]';
const SECONDARY =
  'flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 text-sm text-white transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40';

function Heading({ children }: { children: ReactNode }) {
  return <h1 className="mt-2 font-heading text-2xl leading-tight text-white">{children}</h1>;
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm leading-6 text-white/80">{children}</p>;
}

function JoinBody(props: {
  loaded: Loaded;
  busy: boolean;
  email: string;
  linkSent: boolean;
  onEmail: (v: string) => void;
  onAccept: () => void;
  onGoogle: () => void;
  onMagicLink: (e: FormEvent) => void;
  onSignOut: () => void;
  onResetLink: () => void;
}) {
  const { loaded, busy } = props;

  if (loaded.kind === 'loading') {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-white/80" role="status">
        <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Reading the invitation…
      </div>
    );
  }

  if (loaded.kind === 'missing') {
    return (
      <>
        <Heading>{loaded.notFound ? 'Invitation not found' : 'Something went wrong'}</Heading>
        <Lead>
          {loaded.notFound ? 'Check the link in your email, or ask for a new invitation.' : loaded.message}
        </Lead>
      </>
    );
  }

  if (loaded.kind === 'joined' && loaded.project) {
    return (
      <>
        <Heading>{loaded.project.name}</Heading>
        <div role="status" className="mt-4 flex items-start gap-2 text-sm leading-6 text-white/80">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#6DC6A4]" aria-hidden="true" />
          <p>You now have access to {loaded.project.name}, shared by {loaded.name}.</p>
        </div>
        <a href={loaded.project.href} className={`${PRIMARY} mt-6`}>
          Open {loaded.project.name}
        </a>
      </>
    );
  }

  if (loaded.kind === 'joined') {
    return (
      <>
        <Heading>{loaded.name}</Heading>
        <div role="status" className="mt-4 flex items-start gap-2 text-sm leading-6 text-white/80">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#6DC6A4]" aria-hidden="true" />
          <p>You are now a member of {loaded.name}.</p>
        </div>
        {loaded.slug && (
          <a href={`/o/${loaded.slug}`} className={`${PRIMARY} mt-6`}>
            Open {loaded.name}
          </a>
        )}
      </>
    );
  }

  const p = loaded.preview;
  const step = joinStep(p);
  // A project invitation is about ONE project; its page says so and names what is shared.
  const subject = p.project ? p.project.name : p.org.name;

  return (
    <>
      <Heading>{subject}</Heading>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">{grantLabel(p)}</p>

      {step === 'member' && p.project && (
        <>
          <Lead>You already have access to {p.project.name}.</Lead>
          {p.project.href && (
            <a href={p.project.href} className={`${PRIMARY} mt-6`}>
              Open {p.project.name}
            </a>
          )}
        </>
      )}
      {step === 'member' && !p.project && (
        <>
          <Lead>You are a member of {p.org.name}.</Lead>
          {p.org.slug && (
            <a href={`/o/${p.org.slug}`} className={`${PRIMARY} mt-6`}>
              Open {p.org.name}
            </a>
          )}
        </>
      )}
      {step === 'revoked' && <Lead>This invitation was withdrawn. Ask the person who sent it for a new one.</Lead>}
      {step === 'expired' && <Lead>This invitation has expired. Invitations last 7 days; ask for a new one.</Lead>}
      {step === 'used' && <Lead>This invitation has already been used. Each link works once.</Lead>}

      {step === 'ready' && (
        <>
          <Lead>
            {p.project
              ? `${p.org.name} shared ${p.project.name} with you. You will see this project only, not the rest of ${p.org.name}.`
              : `You have been invited to join ${p.org.name}.`}
          </Lead>
          <button type="button" onClick={props.onAccept} disabled={busy} className={`${PRIMARY} mt-6`}>
            {busy ? 'Joining…' : p.project ? 'Accept and open the project' : 'Accept invitation'}
          </button>
        </>
      )}

      {step === 'wrong_account' && (
        <>
          <Lead>This invitation was sent to a different email address. Sign in with the address it was sent to.</Lead>
          <button type="button" onClick={props.onSignOut} disabled={busy} className={`${SECONDARY} mt-6`}>
            Sign out and switch account
          </button>
        </>
      )}

      {step === 'sign_in' &&
        (props.linkSent ? (
          <div role="status" className="mt-6 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6">
            <p className="text-white/80">Check your inbox for {props.email.trim()}.</p>
            <p className="mt-1 text-[var(--text-readable)]">The sign-in link brings you back here to accept.</p>
            <button type="button" onClick={props.onResetLink} className="mt-3 text-sm text-white/80 underline underline-offset-4 hover:text-white">
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <Lead>Sign in with the email address this invitation was sent to.</Lead>
            <form onSubmit={props.onMagicLink} className="mt-6 space-y-3" noValidate>
              <label htmlFor="join-email" className="block font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
                Email address
              </label>
              <div className="relative">
                <Mail size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/60" aria-hidden="true" />
                <input
                  id="join-email"
                  type="email"
                  autoComplete="email"
                  value={props.email}
                  onChange={(e) => props.onEmail(e.target.value)}
                  disabled={busy}
                  placeholder="you@example.com"
                  className="min-h-11 w-full rounded-lg border border-white/10 bg-[#090907] pl-9 pr-3 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none disabled:opacity-40"
                />
              </div>
              <button type="submit" disabled={busy} className={PRIMARY}>
                Email me a sign-in link
              </button>
            </form>
            <div className="my-5 flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 bg-white/10" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">or</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>
            <button type="button" onClick={props.onGoogle} disabled={busy} className={SECONDARY}>
              Continue with Google
            </button>
          </>
        ))}
    </>
  );
}
