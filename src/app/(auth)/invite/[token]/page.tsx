'use client';

import { useEffect, useState, use } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Invite } from '@/lib/types';
import { Loader2, ShieldCheck, Mail, ArrowRight, Music } from 'lucide-react';

export default function InvitePage({ params: paramsPromise }: { params: Promise<{ token: string }> }) {
  const { token } = use(paramsPromise);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInvite() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('invites')
        .select('*')
        .eq('token', token)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (error || !data) {
        setError('INVITE LINK EXPIRED OR INVALID');
      } else {
        setInvite(data as Invite);
        setEmail(data.email);
      }
      setLoading(false);
    }
    fetchInvite();
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    setAccepting(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/library` },
    });

    if (signInError) {
      setError(signInError.message.toUpperCase());
      setAccepting(false);
      return;
    }

    // Mark invite as used
    await supabase
      .from('invites')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);

    setDone(true);
    setAccepting(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090907] flex flex-col items-center justify-center gap-4">
        <Loader2 size={32} className="animate-spin text-[#E7D7BE]" />
        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-[#837B6D] animate-pulse">Verifying Credentials</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090907] flex items-center justify-center px-6 font-sans">
      <div className="w-full max-w-lg animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <div className="flex items-center gap-4 mb-20 group">
          <div className="w-12 h-12 bg-[#E7D7BE] rounded-2xl flex items-center justify-center text-white font-black shadow-2xl shadow-[#E7D7BE]/20 group-hover:scale-110 transition-transform duration-500">
            <Music size={24} />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tighter uppercase text-white leading-none">U2C Beatstore</h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#E7D7BE] mt-1.5">Enterprise Workspace</p>
          </div>
        </div>

        {error && !invite ? (
          <div className="bg-[#1A1813] border border-red-500/20 rounded-3xl p-12 text-center shadow-2xl">
            <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-8 text-red-500">
               <ShieldCheck size={40} />
            </div>
            <h2 className="text-xl font-black uppercase tracking-tight text-white mb-4">Access Denied</h2>
            <p className="text-[10px] font-bold text-[#D0C3AF] uppercase tracking-[0.2em] leading-loose">{error}</p>
            <button onClick={() => window.location.href = '/login'} className="mt-10 text-[10px] font-black uppercase tracking-[0.3em] text-[#E7D7BE] hover:text-white transition-colors">Return to Terminal</button>
          </div>
        ) : done ? (
          <div className="bg-[#1A1813] border border-[#E7D7BE]/20 rounded-3xl p-12 text-center shadow-2xl animate-in zoom-in-95">
             <div className="w-20 h-20 bg-[#E7D7BE]/10 rounded-full flex items-center justify-center mx-auto mb-8 text-[#E7D7BE]">
               <Mail size={40} />
            </div>
            <h2 className="text-xl font-black uppercase tracking-tight text-white mb-4">Transmission Sent</h2>
            <p className="text-[10px] font-bold text-[#D0C3AF] uppercase tracking-[0.2em] leading-loose">
              We dispatched a secure entry link to <span className="text-white">[{email}]</span>. Check your inbox to complete deployment.
            </p>
          </div>
        ) : (
          <form onSubmit={handleAccept} className="bg-[#1A1813] border border-[#2B2821] rounded-[2.5rem] p-12 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <ShieldCheck size={160} className="text-[#E7D7BE]" />
            </div>

            <div className="mb-12 relative">
               <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[#837B6D] mb-3 block">Deployment Invitation</span>
               <h2 className="text-3xl font-black uppercase tracking-tight text-white leading-tight mb-2">Join the Workspace</h2>
               <div className="flex items-center gap-2">
                 <span className="text-[10px] font-bold uppercase tracking-widest bg-[#342F27] text-[#E7D7BE] px-3 py-1 rounded-lg border border-[#E7D7BE]/30">
                  {invite?.role}
                 </span>
               </div>
            </div>

            <div className="space-y-8 relative">
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#837B6D] ml-1">Confirmation Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#837B6D]" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#090907] border border-[#2B2821] rounded-2xl py-4 pl-12 pr-4 text-[11px] font-bold uppercase tracking-widest text-[#F7EBDD] focus:outline-none focus:border-[#E7D7BE] transition-all"
                  />
                </div>
              </div>

              {error && <p className="text-red-500 text-[10px] font-bold uppercase tracking-widest text-center">{error}</p>}

              <button
                type="submit"
                disabled={accepting}
                className="group w-full bg-[#E7D7BE] hover:bg-[#C9BCA8] disabled:bg-[#211F1A] disabled:text-[#837B6D] text-white py-5 rounded-2xl text-[10px] font-black uppercase tracking-[0.4em] transition-all transform hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3 shadow-2xl shadow-[#E7D7BE]/20"
              >
                {accepting ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
                {accepting ? 'Synchronizing' : 'Accept Authorization'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
