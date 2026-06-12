'use client';

import { useRef, useEffect, useState } from 'react';
import { X, ShoppingCart, Trash2, Loader2, Mail, ArrowRight, Music } from 'lucide-react';
import { useCart } from '@/hooks/useCart';

interface CartDrawerProps {
  shareToken: string;
}

export function CartDrawer({ shareToken }: CartDrawerProps) {
  const { items, removeItem, clearCart, cartTotal, isOpen, setIsOpen } = useCart();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [isOpen, setIsOpen]);

  const handleCheckout = async () => {
    setError(null);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Enter a valid email — we'll send your license files here.");
      return;
    }
    if (!items.length) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/share/${shareToken}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyer_email: email.trim(),
          cart_items: items.map((i) => ({
            track_id: i.track.id,
            license_id: i.license.id,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed. Try again.');
      setLoading(false);
    }
  };

  const total = cartTotal();

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={() => setIsOpen(false)}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed right-0 top-0 bottom-0 w-full sm:w-[400px] bg-[#11100D] border-l border-[#2B2821] z-50 flex flex-col shadow-[0_0_80px_rgba(0,0,0,0.9)] animate-in slide-in-from-right duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#2B2821] bg-[#0e0c09]">
          <div className="flex items-center gap-3">
            <ShoppingCart size={16} className="text-[#E7D7BE]" />
            <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-[#F7EBDD]">
              Cart
            </h2>
            {items.length > 0 && (
              <span className="text-[10px] font-mono text-[#B4AA99] bg-[#211F1A] border border-[#3B372F] px-2 py-0.5 rounded-full">
                {items.length} {items.length === 1 ? 'item' : 'items'}
              </span>
            )}
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="w-8 h-8 flex items-center justify-center text-[#B4AA99] hover:text-[#F7EBDD] hover:bg-white/[0.04] rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
              <div className="w-16 h-16 rounded-full bg-[#171511] border border-[#2B2821] flex items-center justify-center">
                <ShoppingCart size={22} className="text-[#6E685B]" />
              </div>
              <p className="text-[12px] text-[#9B9282] leading-relaxed">
                No beats in your cart yet.<br />Click a price to add one.
              </p>
            </div>
          ) : (
            <ul className="space-y-1 px-4">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-3 p-3 rounded-xl bg-[#171511] border border-[#2B2821] group"
                >
                  {/* Cover */}
                  <div className="w-11 h-11 rounded-lg overflow-hidden bg-[#211F1A] border border-[#3B372F] shrink-0">
                    {item.track.cover_url ? (
                      <img src={item.track.cover_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#6E685B]">
                        <Music size={14} />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-white truncate">{item.track.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${
                        item.license.is_exclusive
                          ? 'text-[#E7D7BE] bg-[#E7D7BE]/10 border border-[#E7D7BE]/20'
                          : 'text-[#D0C3AF] bg-[#2B2821] border border-[#3B372F]'
                      }`}>
                        {item.license.name}
                      </span>
                      <span className="text-[9px] font-mono text-[#9B9282]">
                        {item.license.file_types.join(' · ')}
                      </span>
                    </div>
                  </div>

                  {/* Price + Remove */}
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-[13px] font-mono font-bold text-[#F3E6D1] tabular-nums">
                      ${item.license.price_usd.toLocaleString()}
                    </span>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="opacity-0 group-hover:opacity-100 text-[#6E685B] hover:text-red-400 transition-all"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-[#2B2821] px-6 py-6 space-y-4 bg-[#0e0c09]">
            {/* Total */}
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#B4AA99]">Total</span>
              <span className="text-2xl font-mono font-bold text-white tabular-nums">
                ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <label className="text-[10px] font-mono uppercase tracking-wider text-[#B4AA99] flex items-center gap-1.5">
                <Mail size={10} />
                Email for license delivery
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                placeholder="you@example.com"
                className="w-full bg-[#11100D] border border-[#2B2821] focus:border-[#E7D7BE]/40 rounded-lg py-2.5 px-3 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] outline-none transition-colors"
              />
              {error && (
                <p className="text-[11px] text-red-400 leading-tight">{error}</p>
              )}
            </div>

            {/* Checkout */}
            <button
              onClick={handleCheckout}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#E7D7BE] text-black text-[12px] font-bold uppercase tracking-widest hover:bg-[#F3E6D1] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <>
                  Checkout · ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <ArrowRight size={14} />
                </>
              )}
            </button>

            <button
              onClick={clearCart}
              className="w-full text-[10px] font-mono uppercase tracking-wider text-[#6E685B] hover:text-[#B4AA99] transition-colors py-1"
            >
              Clear cart
            </button>
          </div>
        )}

        <style jsx>{`
          .custom-scrollbar::-webkit-scrollbar { width: 0px; }
        `}</style>
      </div>
    </>
  );
}
