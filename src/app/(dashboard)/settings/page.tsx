'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { UserPlus, Settings as SettingsIcon, Loader2, LogOut, CheckCircle2, Shield, User, DollarSign, Image as ImageIcon, Contact, Save } from 'lucide-react';

interface TeamMember {
  user_id: string;
  role: 'owner' | 'admin' | 'collaborator';
  email: string;
  name: string;
}

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'collaborator'>('collaborator');
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);

  // Creator Profile State
  const [profile, setProfile] = useState({
    display_name: '',
    bio: '',
    hero_image_url: '',
    credits: '',
    license_lease_price_usd: '',
    license_exclusive_price_usd: '',
    license_notes: '',
    license_agreement: '',
    default_discount_percent: '',
    contact_email: '',
    instagram_handle: '',
    twitter_handle: '',
    spotify_url: '',
    soundcloud_url: '',
    website_url: '',
  });
  const [profileLoading, setProfileLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewView, setPreviewView] = useState<'client' | 'producer' | 'rapper'>('client');

  useEffect(() => {
    // Team fetch
    setLoading(false);

    // Profile fetch
    const fetchProfile = async () => {
      try {
        const res = await fetch('/api/profile');
        if (res.ok) {
          const data = await res.json();
          if (data.profile) {
            setProfile({
              display_name: data.profile.display_name || '',
              bio: data.profile.bio || '',
              hero_image_url: data.profile.hero_image_url || '',
              credits: data.profile.credits || '',
              license_lease_price_usd: data.profile.license_lease_price_usd != null ? String(data.profile.license_lease_price_usd) : '',
              license_exclusive_price_usd: data.profile.license_exclusive_price_usd != null ? String(data.profile.license_exclusive_price_usd) : '',
              license_notes: data.profile.license_notes || '',
              license_agreement: data.profile.license_agreement || '',
              default_discount_percent: data.profile.default_discount_percent != null ? String(data.profile.default_discount_percent) : '',
              contact_email: data.profile.contact_email || '',
              instagram_handle: data.profile.instagram_handle || '',
              twitter_handle: data.profile.twitter_handle || '',
              spotify_url: data.profile.spotify_url || '',
              soundcloud_url: data.profile.soundcloud_url || '',
              website_url: data.profile.website_url || '',
            });
          }
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
      } finally {
        setProfileLoading(false);
      }
    };
    fetchProfile();
  }, []);

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

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSuccess(false);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...profile,
          license_lease_price_usd: profile.license_lease_price_usd ? Number(profile.license_lease_price_usd) : null,
          license_exclusive_price_usd: profile.license_exclusive_price_usd ? Number(profile.license_exclusive_price_usd) : null,
          default_discount_percent: profile.default_discount_percent ? Number(profile.default_discount_percent) : null,
        }),
      });
      if (res.ok) {
        setProfileSuccess(true);
        setTimeout(() => setProfileSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Error saving profile:', err);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setProfile((prev) => ({ ...prev, hero_image_url: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <DashboardLayout>
      <div className="max-w-[900px] mx-auto px-10 pt-10 pb-32">
        {/* Header */}
        <div className="relative mb-8 rounded-2xl overflow-hidden border border-white/[0.05] bg-gradient-to-br from-[#14110d]/50 via-[#0a0907]/30 to-[#0a0907] p-8">
          {/* Abstract Image Background */}
          <div className="absolute inset-0 z-0 bg-[url('/images/hero-abstract-3.jpg')] bg-cover bg-center opacity-20 mix-blend-overlay" />
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#E8D8B8] mb-2">Workspace</p>
              <h1 className="text-[40px] font-bold tracking-tight text-white leading-none font-heading mb-1 text-uppercase">Settings</h1>
            </div>
            <button
              onClick={() => signOut()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/[0.06] text-[12px] font-medium text-[#a08a6a] hover:text-red-400 hover:border-red-400/30 hover:bg-white/[0.02] transition-all"
            >
              <LogOut size={13} />
              Sign out
            </button>
          </div>
        </div>

        <div className="space-y-12">
          
          {/* Creator Profile Form */}
          <section className="bg-[#14110d] border border-[#1a160f] rounded-2xl p-8 shadow-xl">
            <div className="flex items-center justify-between gap-4 mb-6 border-b border-[#1a160f] pb-4 flex-wrap">
              <div className="flex items-center gap-3">
                <User size={18} className="text-[#a08a6a]" />
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[#E8DCC8]">Creator Profile</h2>
                  <p className="text-[10px] uppercase tracking-widest text-[#5a5142] mt-0.5 font-bold">Customize your public listener landing page</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-[#2d2620] hover:border-[#D4BFA0]/50 text-[10px] font-bold uppercase tracking-wider text-[#a08a6a] hover:text-[#E8DCC8] transition-all bg-[#0a0907]"
              >
                <ImageIcon size={11} />
                Preview Profile
              </button>
            </div>

            {profileLoading ? (
              <div className="py-12 flex justify-center"><Loader2 size={20} className="animate-spin text-[#a08a6a]" /></div>
            ) : (
              <form onSubmit={handleSaveProfile} className="space-y-6">
                
                {/* 1. Basic Showcase */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Display Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Uche Beatstore"
                      className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                      value={profile.display_name}
                      onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Hero Image Portrait</label>
                    <div className="flex gap-4 items-center">
                      {profile.hero_image_url ? (
                        <div className="w-12 h-12 rounded-lg overflow-hidden border border-[#1f1a13] shrink-0 bg-[#0c0a08]">
                          <img loading="lazy" src={profile.hero_image_url} alt="" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-lg border border-[#1f1a13] border-dashed flex items-center justify-center text-[#3a3328] shrink-0 bg-[#0c0a08]">
                          <ImageIcon size={16} />
                        </div>
                      )}
                      <label className="flex-1 cursor-pointer bg-[#0c0a08] border border-[#1f1a13] hover:border-[#D4BFA0]/50 rounded-lg py-2.5 px-4 text-center text-xs text-[#a08a6a] hover:text-[#E8DCC8] transition-colors">
                        Choose / Drag photo
                        <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                      </label>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Bio Introduction</label>
                  <textarea
                    rows={4}
                    placeholder="Tell your story. This paragraph leads your public client landing page..."
                    className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors resize-none leading-relaxed"
                    value={profile.bio}
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Credits List (One per line)</label>
                  <textarea
                    rows={3}
                    placeholder="Drake - Honestly Nevermind&#10;Lil Baby - It's Only Me&#10;Gunna - DS4EVER"
                    className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors resize-none font-mono leading-relaxed"
                    value={profile.credits}
                    onChange={(e) => setProfile({ ...profile, credits: e.target.value })}
                  />
                </div>

                {/* 2. Commercial Licensing */}
                <div className="border-t border-[#1a160f] pt-6">
                  <div className="flex items-center gap-2 mb-4 text-[#a08a6a]">
                    <DollarSign size={14} />
                    <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] font-bold">Licensing &amp; Commercial terms</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Lease Price (USD)</label>
                      <input
                        type="number"
                        placeholder="e.g. 150"
                        className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors font-mono"
                        value={profile.license_lease_price_usd}
                        onChange={(e) => setProfile({ ...profile, license_lease_price_usd: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Exclusive Price (USD)</label>
                      <input
                        type="number"
                        placeholder="e.g. 2500"
                        className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors font-mono"
                        value={profile.license_exclusive_price_usd}
                        onChange={(e) => setProfile({ ...profile, license_exclusive_price_usd: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Licensing Notes &amp; Terms</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. 50/50 split on master and publishing. Custom stems sent on full payout."
                      className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors resize-none leading-relaxed"
                      value={profile.license_notes}
                      onChange={(e) => setProfile({ ...profile, license_notes: e.target.value })}
                    />
                  </div>
                </div>

                {/* 3. Get in Touch / Socials */}
                <div className="border-t border-[#1a160f] pt-6">
                  <div className="flex items-center gap-2 mb-4 text-[#a08a6a]">
                    <Contact size={14} />
                    <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] font-bold">Contact &amp; Social links</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Contact Email</label>
                      <input
                        type="email"
                        placeholder="producer@email.com"
                        className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                        value={profile.contact_email}
                        onChange={(e) => setProfile({ ...profile, contact_email: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Website URL</label>
                      <input
                        type="url"
                        placeholder="https://mywebsite.com"
                        className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                        value={profile.website_url}
                        onChange={(e) => setProfile({ ...profile, website_url: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Instagram Handle</label>
                      <input
                        type="text"
                        placeholder="e.g. uche_music"
                        className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                        value={profile.instagram_handle}
                        onChange={(e) => setProfile({ ...profile, instagram_handle: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Twitter / X Handle</label>
                      <input
                        type="text"
                        placeholder="e.g. uche_music"
                        className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                        value={profile.twitter_handle}
                        onChange={(e) => setProfile({ ...profile, twitter_handle: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Spotify Artist URL</label>
                      <input
                        type="url"
                        placeholder="https://open.spotify.com/artist/..."
                        className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                        value={profile.spotify_url}
                        onChange={(e) => setProfile({ ...profile, spotify_url: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">SoundCloud Profile URL</label>
                      <input
                        type="url"
                        placeholder="https://soundcloud.com/..."
                        className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                        value={profile.soundcloud_url}
                        onChange={(e) => setProfile({ ...profile, soundcloud_url: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* Save button */}
                <button
                  disabled={savingProfile || profileSuccess}
                  type="submit"
                  className={`w-full py-3.5 rounded-xl text-[11px] font-bold uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${
                    profileSuccess
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                      : 'bg-[#D4BFA0] hover:bg-[#8A7A5C] text-black shadow-lg shadow-[#D4BFA0]/10 disabled:opacity-50'
                  }`}
                >
                  {savingProfile ? <Loader2 size={14} className="animate-spin" /> : profileSuccess ? <CheckCircle2 size={14} /> : <Save size={14} />}
                  {savingProfile ? 'Saving profile...' : profileSuccess ? 'Profile saved' : 'Save creator profile'}
                </button>
              </form>
            )}
          </section>

          {/* Team */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Shield size={14} className="text-[#5a5142]" />
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#E8DCC8]">Team members</h2>
            </div>
            {loading ? (
              <div className="py-12 flex justify-center"><Loader2 size={16} className="animate-spin text-[#4a4338]" /></div>
            ) : team.length === 0 ? (
              <div className="bg-[#14110d] border border-[#1a160f] rounded-2xl p-6 text-center">
                <p className="text-[11px] text-[#5a5142]">No team members yet. Invite collaborators below.</p>
              </div>
            ) : (
              <div className="border border-[#1a160f] rounded-2xl divide-y divide-[#161310] overflow-hidden">
                {team.map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between px-4 py-3 bg-[#14110d]/50">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-[#16130e] border border-[#1a160f] flex items-center justify-center text-[10px] font-medium text-[#a08a6a]">
                        {m.name?.[0] || m.email[0]}
                      </div>
                      <div>
                        <p className="text-[12px] font-medium text-[#E8DCC8]">{m.name || m.email}</p>
                        {m.name && <p className="text-[10px] font-mono text-[#5a5142]">{m.email}</p>}
                      </div>
                    </div>
                    <span className={`text-[10px] font-mono uppercase tracking-wider ${m.role === 'owner' ? 'text-[#E8D8B8]' : 'text-[#5a5142]'}`}>
                      {m.role}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Invite */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <UserPlus size={14} className="text-[#5a5142]" />
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#E8DCC8]">Invite collaborator</h2>
            </div>
            <form onSubmit={handleInvite} className="bg-[#14110d] border border-[#1a160f] rounded-2xl p-6 space-y-4">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Email</label>
                <input
                  required
                  type="email"
                  placeholder="name@email.com"
                  className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white placeholder:text-[#3a3328] focus:outline-none focus:border-[#D4BFA0] transition-colors"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-[#5a5142] mb-1.5 block">Role</label>
                <select
                  className="w-full bg-[#0c0a08] border border-[#1a160f] rounded-lg py-3 px-4 text-xs text-white focus:outline-none focus:border-[#D4BFA0] transition-colors appearance-none cursor-pointer"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                >
                  <option value="collaborator">Collaborator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                disabled={sending || success}
                type="submit"
                className={`w-full py-3.5 rounded-xl text-[11px] font-bold uppercase tracking-[0.2em] transition-colors flex items-center justify-center gap-2 ${
                  success
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-white text-black hover:bg-[#E8DCC8] disabled:opacity-50'
                }`}
              >
                {sending ? <Loader2 size={13} className="animate-spin" /> : success ? <CheckCircle2 size={13} /> : <UserPlus size={13} />}
                {sending ? 'Sending...' : success ? 'Invite sent' : 'Send invite'}
              </button>
            </form>
          </section>

          {/* Preferences */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <SettingsIcon size={14} className="text-[#5a5142]" />
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#E8DCC8]">Preferences</h2>
            </div>
            <div className="border border-[#1a160f] rounded-2xl divide-y divide-[#161310] overflow-hidden">
              <ToggleRow title="Lossless exports" description="Prefer WAV/AIFF for shared links" defaultOn />
              <ToggleRow title="Auto-tagging" description="AI analysis tags on upload" defaultOn={false} />
            </div>
          </section>
        </div>
      </div>

      {/* Creator Profile Slide-over Preview */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm transition-all duration-300">
          <div 
            className="w-full max-w-[500px] h-full bg-[#0c0c0c] border-l border-white/[0.08] p-8 flex flex-col justify-between overflow-y-auto relative shadow-2xl"
            style={{
              boxShadow: '-20px 0 50px rgba(0, 0, 0, 0.8)'
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-6 border-b border-white/[0.05] mb-6">
              <div>
                <span className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#7F77DD] font-bold">Creator Universe</span>
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#E8DCC8] mt-1 font-heading">Template Previews</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="px-3 py-1.5 rounded-full border border-white/[0.06] text-[9px] font-bold uppercase tracking-wider text-[#5a5142] hover:text-white hover:border-white/25 transition-all"
              >
                Close Preview
              </button>
            </div>

            {/* View Selector Tabs */}
            <div className="flex bg-[#0c0a08] border border-[#1f1a13] rounded-lg p-0.5 mb-6">
              {(['client', 'producer', 'rapper'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPreviewView(v)}
                  className={`flex-1 py-2 rounded text-[9px] font-bold uppercase tracking-wider transition-all ${
                    previewView === v
                      ? 'bg-[#1e1a14] text-[#E8DCC8] border border-[#2d2620]'
                      : 'text-[#5a5142] hover:text-[#a08a6a]'
                  }`}
                >
                  {v === 'client' ? 'Client' : v === 'producer' ? 'Producer' : 'Rapper'}
                </button>
              ))}
            </div>

            {/* Live Interactive Interface Preview */}
            <div className="flex-1 space-y-8">
              {previewView === 'client' && (
                <>
                  {/* 1. Header Banner & Profile Pic */}
                  <div className="relative rounded-2xl overflow-hidden border border-white/[0.05] bg-gradient-to-br from-[#14110d] via-[#0c0c0c] to-[#0c0c0c] p-6 text-center">
                    <div className="absolute inset-0 bg-gradient-to-t from-[#7F77DD]/[0.03] to-transparent pointer-events-none" />
                    
                    {profile.hero_image_url ? (
                      <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-[#D4BFA0] mx-auto bg-[#0a0907] shadow-xl">
                        <img loading="lazy" src={profile.hero_image_url} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-20 h-20 rounded-full border-2 border-dashed border-[#2d2620] flex items-center justify-center text-[#3a3328] mx-auto bg-[#0a0907]">
                        <User size={28} />
                      </div>
                    )}

                    <h4 className="text-lg font-bold text-white tracking-tight mt-4 uppercase font-heading">{profile.display_name || 'CREATOR NAME'}</h4>
                    <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] mt-1">Independent Artist & Producer</p>
                  </div>

                  {/* 2. Story / Bio */}
                  <div>
                    <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] block mb-2 font-bold font-sans">Intro / Story</span>
                    <div className="bg-[#14110d]/45 border border-[#1a160f] rounded-2xl p-5 relative overflow-hidden">
                      <p className="text-xs text-[#E8DCC8] leading-relaxed font-sans italic opacity-90 whitespace-pre-wrap">
                        {profile.bio || 'Enter a story or bio introduction in settings to light up this segment...'}
                      </p>
                    </div>
                  </div>

                  {/* 3. Commercial Licenses */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[#14110d]/50 border border-[#1a160f] p-4 rounded-xl text-center">
                      <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#5a5142] font-bold">Lease Access</span>
                      <p className="text-xl font-mono text-[#D4BFA0] font-bold mt-1">
                        {profile.license_lease_price_usd ? `$${profile.license_lease_price_usd}` : 'N/A'}
                      </p>
                      <span className="text-[8px] text-[#5a5142] block mt-0.5">High Quality WAV</span>
                    </div>
                    <div className="bg-[#14110d]/50 border border-[#1a160f] p-4 rounded-xl text-center">
                      <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#5a5142] font-bold">Exclusive Rights</span>
                      <p className="text-xl font-mono text-[#7F77DD] font-bold mt-1">
                        {profile.license_exclusive_price_usd ? `$${profile.license_exclusive_price_usd}` : 'N/A'}
                      </p>
                      <span className="text-[8px] text-[#5a5142] block mt-0.5">Unlimited Ownership</span>
                    </div>
                  </div>

                  {/* 4. Custom Terms */}
                  {profile.license_notes && (
                    <div className="bg-[#14110d]/30 border border-[#1a160f] p-4 rounded-xl">
                      <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#5a5142] block mb-1 font-bold">Licensing Terms</span>
                      <p className="text-[10px] text-[#a08a6a] leading-relaxed">{profile.license_notes}</p>
                    </div>
                  )}

                  {/* 5. Production Credits */}
                  {profile.credits && (
                    <div>
                      <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] block mb-2 font-bold font-sans">Verified Credits</span>
                      <div className="flex flex-wrap gap-1.5">
                        {profile.credits.split('\n').filter(Boolean).map((cred, i) => (
                          <span key={i} className="px-2.5 py-1 bg-[#1a1833]/30 border border-[#534AB7]/30 text-[#AFA9EC] text-[9px] font-mono rounded-full font-bold">
                            {cred}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {previewView === 'producer' && (
                <>
                  {/* 4-Channel Mixer Sandbox Preview */}
                  <div className="bg-[#14110d]/50 border border-[#1a160f] rounded-2xl p-6 relative overflow-hidden space-y-6">
                    <div>
                      <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] block mb-1 font-bold">Stems Sandbox Mixer</span>
                      <p className="text-[9px] text-[#5a5142] uppercase tracking-wider font-mono">Simulated isolation mixer for engineer collaboration</p>
                    </div>
                    
                    <div className="space-y-4">
                      {['Vocals', 'Drums', 'Bass', 'Instruments'].map((stemName, i) => (
                        <div key={i} className="space-y-1.5">
                          <div className="flex justify-between text-[9px] uppercase tracking-widest font-mono">
                            <span className="text-[#E8DCC8] font-bold">{stemName}</span>
                            <span className="text-[#a08a6a]">{i === 0 ? 'MUTED' : 'ACTIVE · SOLO'}</span>
                          </div>
                          <div className="relative h-2 bg-[#0a0907] rounded-full overflow-hidden border border-white/[0.03]">
                            <div 
                              className={`h-full rounded-full ${i === 0 ? 'bg-[#3a3328]' : 'bg-[#D4BFA0]'}`}
                              style={{ width: i === 0 ? '0%' : i === 1 ? '90%' : '75%' }}
                            />
                            <div 
                              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border border-[#2d2620] shadow-md cursor-pointer transition-all"
                              style={{ left: i === 0 ? '0%' : i === 1 ? '90%' : '75%', transform: 'translate(-50%, -50%)' }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="pt-4 border-t border-[#1f1a13] flex justify-between items-center text-[9px] font-mono uppercase tracking-wider">
                      <span className="text-[#5a5142]">Stem Job Status</span>
                      <span className="text-green-400 font-bold bg-[#0c1f0c] px-2 py-0.5 rounded border border-[#1f3a1f]">ANALYZED</span>
                    </div>
                  </div>
                </>
              )}

              {previewView === 'rapper' && (
                <>
                  {/* Lyrics studio & rhyme notepad */}
                  <div className="bg-[#14110d]/50 border border-[#1a160f] rounded-2xl p-6 relative overflow-hidden space-y-5">
                    <div>
                      <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#a08a6a] block mb-2 font-bold">Vocalist Lyrics Pad</span>
                      <div className="bg-[#0a0907]/90 border border-[#1f1a13] p-4 rounded-xl max-h-36 overflow-y-auto space-y-2 font-mono text-[10px] text-white/90 leading-relaxed">
                        <p className="text-[#D4BFA0] font-bold">Verse 1:</p>
                        <p className="opacity-75">I build the beats inside the absolute dark</p>
                        <p className="opacity-75">Riding the wavelengths, lighting the spark</p>
                        <p className="opacity-75">Antigravity lift, pulling us higher</p>
                      </div>
                    </div>
                    
                    <div>
                      <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] block mb-2 font-bold">Writer's Notepad &amp; Rhyme Helper</span>
                      <div className="bg-[#0a0907]/60 border border-[#1f1a13] p-4 rounded-xl space-y-2">
                        <div className="h-6 border-b border-[#1f1a13] text-[9px] text-[#6a5d4a] uppercase tracking-wider font-mono flex items-center justify-between">
                          <span>Rhymes matching "spark"</span>
                          <span className="text-[#D4BFA0] font-bold">4 matches</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {['dark', 'ark', 'park', 'mark'].map((w) => (
                            <span key={w} className="px-2 py-0.5 bg-[#1a1610]/40 border border-[#2d2620] text-[#a08a6a] text-[9px] rounded font-mono">
                              {w}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer Links */}
            <div className="border-t border-white/[0.05] pt-6 mt-6 flex justify-center gap-4 text-[#a08a6a]">
              {profile.contact_email && <span className="text-[10px] font-mono">Email: {profile.contact_email}</span>}
              {profile.instagram_handle && <span className="text-[10px] font-mono">IG: @{profile.instagram_handle}</span>}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function ToggleRow({ title, description, defaultOn = false }: { title: string; description: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between px-6 py-4 bg-[#14110d]/50 hover:bg-[#14110d] transition-colors cursor-pointer" onClick={() => setOn(!on)}>
      <div>
        <p className="text-[12px] font-medium text-[#E8DCC8]">{title}</p>
        <p className="text-[10px] text-[#5a5142] mt-0.5">{description}</p>
      </div>
      <div className={`w-9 h-5 rounded-full relative transition-colors ${on ? 'bg-[#D4BFA0]' : 'bg-[#1a160f] border border-[#2d2620]'}`}>
        <div className={`w-3.5 h-3.5 rounded-full absolute top-[3px] transition-all ${on ? 'right-[3px] bg-white' : 'left-[3px] bg-[#5a5142]'}`} />
      </div>
    </div>
  );
}
