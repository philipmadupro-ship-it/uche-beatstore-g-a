'use client';

import { X, Play, Pause, Music, ShoppingCart, Info, CheckCircle, XCircle, Tag } from 'lucide-react';
import { useCart } from '@/hooks/useCart';

interface CreatorProfile {
  display_name?: string | null;
  license_lease_price_usd?: number | null;
  license_exclusive_price_usd?: number | null;
  license_notes?: string | null;
}

interface Track {
  id: string;
  title: string;
  type: string;
  audio_url: string;
  cover_url?: string | null;
  duration_seconds?: number | null;
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  description?: string | null;
  lease_price_usd?: number | null;
  exclusive_price_usd?: number | null;
}

interface ShareTrackDetailsDrawerProps {
  track: Track | null;
  projectCover?: string | null;
  creator: CreatorProfile | null;
  shareToken?: string;
  shareLeasePrice?: number | null;
  shareExclusivePrice?: number | null;
  shareDiscountPercent?: number | null;
  onClose: () => void;
  onPlay: (track: Track) => void;
  isPlaying: boolean;
  playingId: string | null;
  currentTime: number;
  duration: number;
  progressPct: number;
  onSeek: (seconds: number) => void;
}

const LICENSE_FEATURES = {
  lease: [
    { label: 'MP3 + WAV files', included: true },
    { label: 'Unlimited streaming', included: true },
    { label: 'Up to 100k streams', included: true },
    { label: 'Music video (1 release)', included: true },
    { label: 'Trackout stems', included: false },
    { label: 'Exclusive rights', included: false },
    { label: 'Radio & sync clearance', included: false },
  ],
  exclusive: [
    { label: 'MP3 + WAV files', included: true },
    { label: 'Unlimited streaming', included: true },
    { label: 'Unlimited streams', included: true },
    { label: 'Music video (unlimited)', included: true },
    { label: 'Trackout stems', included: true },
    { label: 'Exclusive rights', included: true },
    { label: 'Radio & sync clearance', included: true },
  ],
};

export function ShareTrackDetailsDrawer({
  track,
  projectCover,
  creator,
  shareToken,
  shareLeasePrice,
  shareExclusivePrice,
  shareDiscountPercent,
  onClose,
  onPlay,
  isPlaying,
  playingId,
  currentTime,
  duration,
  progressPct,
  onSeek,
}: ShareTrackDetailsDrawerProps) {
  const { addItem, setIsOpen: setCartOpen, items: cartItems } = useCart();

  if (!track) return null;

  const isActive = playingId === track.id;
  const isCurrentPlaying = isActive && isPlaying;
  const cover = track.cover_url || projectCover || null;

  const discount =
    shareDiscountPercent != null && shareDiscountPercent > 0 && shareDiscountPercent <= 100
      ? shareDiscountPercent
      : null;

  // Price resolution: share override → track override → creator default
  const resolveBase = (
    sharePrice: number | null | undefined,
    trackPrice: number | null | undefined,
    creatorPrice: number | null | undefined,
  ) =>
    sharePrice ??
    (trackPrice != null ? Number(trackPrice) : null) ??
    (creatorPrice != null ? Number(creatorPrice) : null);

  const baseLeasePrice = resolveBase(
    shareLeasePrice,
    track.lease_price_usd,
    creator?.license_lease_price_usd,
  );
  const baseExclusivePrice = resolveBase(
    shareExclusivePrice,
    track.exclusive_price_usd,
    creator?.license_exclusive_price_usd,
  );

  const leasePrice = baseLeasePrice != null
    ? (discount ? baseLeasePrice * (1 - discount / 100) : baseLeasePrice)
    : null;
  const exclusivePrice = baseExclusivePrice != null
    ? (discount ? baseExclusivePrice * (1 - discount / 100) : baseExclusivePrice)
    : null;

  const hasPricing = leasePrice != null || exclusivePrice != null;
  const isMinor = track.scale === 'minor';
  const inCart = cartItems.some((i) => i.track.id === track.id);

  const handlePlayToggle = () => onPlay(track);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActive || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct * duration);
  };

  const handleBuy = (licenseType: 'lease' | 'exclusive') => {
    if (!shareToken) return;
    const price = licenseType === 'lease' ? leasePrice : exclusivePrice;
    if (price == null) return;
    addItem(track as any, {
      id: licenseType === 'lease' ? 'basic-lease' : 'exclusive-rights',
      name: licenseType === 'lease' ? 'Basic Lease' : 'Exclusive Rights',
      price_usd: price,
      file_types: licenseType === 'lease' ? ['MP3', 'WAV'] : ['MP3', 'WAV', 'STEMS'],
      is_exclusive: licenseType === 'exclusive',
    });
    setCartOpen(true);
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-sm z-40 animate-in fade-in duration-300"
        onClick={onClose}
      />

      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[440px] bg-[#0c0c0c] border-l border-[#2B2821] z-50 flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.8)] animate-in slide-in-from-right duration-300">

        {/* Header */}
        <div className="px-6 py-5 border-b border-[#2B2821] flex items-center justify-between bg-[#0e0c09]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#D0C3AF] bg-[#2B2821] px-2 py-0.5 rounded">
                {track.type}
              </span>
              {track.key && (
                <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                  isMinor
                    ? 'text-[#9d95e8] bg-[#1a1833]/60 border border-[#534AB7]/30'
                    : 'text-[#c8a47a] bg-[#1f1a10]/60 border border-[#3d3020]/40'
                }`}>
                  {track.key}{isMinor ? 'm' : ''}
                </span>
              )}
              {inCart && (
                <span className="text-[8px] font-mono uppercase tracking-wider text-[#6DC6A4] bg-[#0e1f17] border border-[#6DC6A4]/20 px-1.5 py-0.5 rounded-full">
                  In cart
                </span>
              )}
            </div>
            <h2 className="text-[16px] font-bold text-white uppercase tracking-wider truncate mt-1.5 leading-none">
              {track.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#B4AA99] hover:text-[#F7EBDD] p-2 hover:bg-white/[0.03] rounded-lg transition-colors border border-white/[0.03] ml-3 shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-7 custom-scrollbar">

          {/* Cover */}
          <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-[#171511] border border-[#2B2821] group shadow-2xl">
            {cover ? (
              <img src={cover} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#6E685B]">
                <Music size={64} />
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handlePlayToggle}
                className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform shadow-2xl"
              >
                {isCurrentPlaying ? (
                  <Pause size={22} fill="currentColor" />
                ) : (
                  <Play size={22} className="ml-1" fill="currentColor" />
                )}
              </button>
            </div>
          </div>

          {/* Inline player */}
          <div className="bg-[#171511] border border-[#2B2821] rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <button
                onClick={handlePlayToggle}
                className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform shrink-0"
              >
                {isCurrentPlaying ? (
                  <Pause size={13} fill="currentColor" />
                ) : (
                  <Play size={13} className="ml-0.5" fill="currentColor" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono text-[#D0C3AF] uppercase tracking-wider">
                  {isActive ? (isCurrentPlaying ? 'Now playing' : 'Paused') : 'Preview'}
                </p>
                <p className="text-[12px] font-medium text-white truncate mt-0.5">{track.title}</p>
              </div>
            </div>
            <div className="space-y-1">
              <div
                onClick={handleSeek}
                className={`h-1.5 rounded-full relative cursor-pointer ${isActive ? 'bg-[#2B2821]' : 'bg-[#2B2821]/40'}`}
              >
                <div
                  className="h-full bg-[#E7D7BE] rounded-full transition-all"
                  style={{ width: `${isActive ? progressPct : 0}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-[#9B9282] tabular-nums">
                <span>{isActive ? fmt(currentTime) : '0:00'}</span>
                <span>{isActive && duration > 0 ? fmt(duration) : fmt(track.duration_seconds || 0)}</span>
              </div>
            </div>
          </div>

          {/* Beat stats */}
          <div className="grid grid-cols-3 gap-2">
            <StatCell label="BPM" value={track.bpm ? String(track.bpm) : '—'} />
            <StatCell
              label="Key"
              value={track.key ? `${track.key}${isMinor ? 'm' : ''}` : '—'}
              accent={track.key ? (isMinor ? 'minor' : 'major') : undefined}
            />
            <StatCell
              label="Duration"
              value={track.duration_seconds ? fmt(track.duration_seconds) : '—'}
            />
          </div>

          {/* Description */}
          {track.description && (
            <div className="space-y-2">
              <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#D0C3AF]">Description</p>
              <p className="text-[12px] text-[#F7EBDD]/80 leading-relaxed bg-[#171511]/30 border border-white/[0.02] p-3.5 rounded-xl whitespace-pre-wrap">
                {track.description}
              </p>
            </div>
          )}

          {/* Pricing + license feature comparison */}
          {shareToken && hasPricing ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#D0C3AF]">Purchase License</p>
                {discount != null && (
                  <span className="flex items-center gap-1 text-[9px] font-mono font-bold text-[#6DC6A4] bg-[#0e1f17] border border-[#6DC6A4]/20 px-2 py-0.5 rounded-full">
                    <Tag size={8} />
                    {discount}% off
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {leasePrice != null && (
                  <LicenseCard
                    type="lease"
                    label="Basic Lease"
                    price={leasePrice}
                    originalPrice={discount && baseLeasePrice != null ? baseLeasePrice : null}
                    badge="Most Popular"
                    onBuy={() => handleBuy('lease')}
                    showToken={!!shareToken}
                  />
                )}
                {exclusivePrice != null && (
                  <LicenseCard
                    type="exclusive"
                    label="Exclusive Rights"
                    price={exclusivePrice}
                    originalPrice={discount && baseExclusivePrice != null ? baseExclusivePrice : null}
                    onBuy={() => handleBuy('exclusive')}
                    showToken={!!shareToken}
                  />
                )}
              </div>
            </div>
          ) : (
            shareToken && (
              <div className="bg-[#171511]/20 border border-white/[0.02] rounded-xl p-4 flex gap-3 text-[#B4AA99]">
                <Info size={14} className="shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  Preview only. No prices set for this track yet.
                </p>
              </div>
            )
          )}
        </div>

        <style jsx>{`
          .custom-scrollbar::-webkit-scrollbar { width: 0px; }
        `}</style>
      </div>
    </>
  );
}

function StatCell({ label, value, accent }: { label: string; value: string; accent?: 'minor' | 'major' }) {
  return (
    <div className="bg-[#171511]/50 border border-[#2B2821]/60 rounded-xl p-3 text-center">
      <p className="text-[8px] font-mono uppercase tracking-widest text-[#9B9282]">{label}</p>
      <p className={`text-[13px] font-bold mt-1 font-mono ${
        accent === 'minor' ? 'text-[#9d95e8]' :
        accent === 'major' ? 'text-[#c8a47a]' :
        'text-white'
      }`}>
        {value}
      </p>
    </div>
  );
}

function LicenseCard({
  type, label, price, originalPrice, badge, onBuy, showToken,
}: {
  type: 'lease' | 'exclusive';
  label: string;
  price: number;
  originalPrice: number | null;
  badge?: string;
  onBuy: () => void;
  showToken: boolean;
}) {
  const isExclusive = type === 'exclusive';
  const features = LICENSE_FEATURES[type];
  const savings = originalPrice != null ? originalPrice - price : null;

  return (
    <div className={`rounded-xl border p-4 space-y-3 relative overflow-hidden ${
      isExclusive
        ? 'border-[#E7D7BE]/20 bg-gradient-to-br from-[#1a160d] to-[#11100D]'
        : 'border-[#2B2821] bg-[#171511]'
    }`}>
      {badge && !isExclusive && (
        <span className="absolute top-3 right-3 text-[8px] font-mono uppercase tracking-[0.15em] text-[#D0C3AF] bg-[#2B2821] border border-[#3B372F] px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}

      {/* Price row */}
      <div className="flex items-end gap-3">
        <div>
          <p className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] mb-0.5">{label}</p>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-mono font-bold ${isExclusive ? 'text-[#E7D7BE]' : 'text-white'}`}>
              ${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
            {originalPrice && (
              <span className="text-[12px] font-mono text-[#6E685B] line-through tabular-nums">
                ${Math.round(originalPrice).toLocaleString()}
              </span>
            )}
          </div>
          {savings != null && savings > 0 && (
            <p className="text-[9px] font-mono text-[#6DC6A4] mt-0.5">
              Save ${Math.round(savings).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* Feature list */}
      <ul className="grid grid-cols-1 gap-1.5">
        {features.map((f) => (
          <li key={f.label} className="flex items-center gap-2 text-[10px]">
            {f.included ? (
              <CheckCircle size={10} className={`shrink-0 ${isExclusive ? 'text-[#E7D7BE]' : 'text-[#8ecf9f]'}`} />
            ) : (
              <XCircle size={10} className="shrink-0 text-[#3B372F]" />
            )}
            <span className={f.included ? 'text-[#D0C3AF]' : 'text-[#3B372F]'}>{f.label}</span>
          </li>
        ))}
      </ul>

      {/* Buy button */}
      {showToken && (
        <button
          onClick={onBuy}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
            isExclusive
              ? 'bg-[#E7D7BE] text-black hover:bg-[#F3E6D1]'
              : 'bg-white/[0.05] border border-white/[0.10] hover:bg-white/[0.10] text-[#F7EBDD]'
          }`}
        >
          <ShoppingCart size={11} />
          Add to cart
        </button>
      )}
    </div>
  );
}
