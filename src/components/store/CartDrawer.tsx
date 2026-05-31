'use client';

/**
 * CartDrawer — slide-in purchase cart shared across all /store/* pages.
 *
 * Reads cart state from the global useCart store and fires the Stripe
 * checkout API on submit. Extracted from store/page.tsx so it can be
 * mounted once in the store layout rather than duplicated per page.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, X, Music, Loader2, Tag } from 'lucide-react';
import { useCart } from '@/hooks/useCart';
import { toast } from '@/hooks/useToast';
import type { Track } from '@/lib/types';

interface CartItem {
  id: string;
  track: Track;
  license: {
    name: string;
    price_usd: number;
    is_exclusive: boolean;
  };
}

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  items: CartItem[];
  removeItem: (id: string) => void;
  total: number;
}

export function CartDrawer({ open, onClose, items: rawItems, removeItem, total: rawTotal }: CartDrawerProps) {
  const router = useRouter();
  const [buyerEmail, setBuyerEmail] = useState('');
  const [promoCode, setPromoCode] = useState('');

  // Gate cart-derived values on a client-mounted flag. items + total
  // come from useCart (Zustand + localStorage persist), so SSR renders
  // an empty cart while the client renders the persisted state, causing
  // a hydration mismatch on the total. Use the SSR-shape (empty + 0)
  // on the first paint, then swap to the real values after mount.
  const [mounted, setMounted] = useState(false);
  const bundleRule = useCart((s) => s.bundleRule);
  const items = mounted ? rawItems : [];
  const total = mounted ? rawTotal : 0;

  // Automatic bundle/quantity discount preview (Task 7). The server is the
  // source of truth at checkout; this just shows the buyer the deal early.
  const bundleQualifies = !!bundleRule && bundleRule.percent > 0 && items.length >= bundleRule.threshold;
  const bundleTotal = bundleQualifies ? total * (1 - bundleRule!.percent / 100) : total;

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem('antigravity-buyer-email');
    if (stored) {
      setBuyerEmail(stored);
    }
  }, []);

  const handleCheckout = () => {
    if (items.length === 0) return;
    onClose();
    const params = new URLSearchParams();
    if (buyerEmail.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail.trim())) {
      params.set('email', buyerEmail.trim());
    }
    if (promoCode.trim()) {
      params.set('promo', promoCode.trim().toUpperCase());
    }
    const qs = params.toString();
    router.push(`/store/checkout${qs ? `?${qs}` : ''}`);
  };

  return (
    <>
      {/* Backdrop — pointer-events toggled so it doesn't block interaction when closed */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!open}
      />

      {/* Drawer — always mounted, translate-x for slide animation */}
      <aside
        className={`fixed top-0 right-0 bottom-0 z-[90] w-full sm:w-[420px] bg-gradient-to-b from-[#101012]/95 via-[#0a0907]/95 to-[#0a0907]/95 backdrop-blur-2xl border-l border-white/[0.06] shadow-[-12px_0_40px_rgba(0,0,0,0.5)] flex flex-col transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
          <h2 className="text-[12px] font-mono uppercase tracking-[0.2em] text-[#E8DCC8] flex items-center gap-2">
            <ShoppingCart size={13} className="text-[#E8D8B8]" />
            Cart · {items.length}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#6a5d4a] hover:text-white hover:bg-white/[0.06]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {items.length === 0 ? (
            <div className="text-center py-16 text-[#5a5142] text-[12px]">Cart empty</div>
          ) : (
            <ul className="space-y-2">
              {items.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]"
                >
                  <div className="w-10 h-10 rounded bg-[#0a0907] border border-[#1f1a13] overflow-hidden shrink-0">
                    {i.track.cover_url
                      ? <img loading="lazy" src={i.track.cover_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Music size={14} /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-[#E8DCC8] truncate">{i.track.title}</p>
                    <p className="text-[10px] font-mono text-[#6a5d4a] uppercase tracking-wider mt-0.5">
                      {i.license.name} · ${i.license.price_usd.toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => removeItem(i.id)}
                    className="text-[#6a5d4a] hover:text-red-400 transition-colors"
                    aria-label="Remove"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.04] px-5 py-4 space-y-3 bg-[#0a0907]/40">
          {bundleQualifies && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#6DC6A4]/10 border border-[#6DC6A4]/30">
              <span className="text-[11px] font-semibold text-[#6DC6A4]">Bundle deal applied 🎉</span>
              <span className="text-[11px] font-mono font-bold text-[#6DC6A4]">-{bundleRule!.percent}%</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a]">Total</span>
            {bundleQualifies ? (
              <span className="flex items-baseline gap-2">
                <span className="text-[12px] font-mono text-[#5a5142] line-through tabular-nums">${total.toLocaleString()}</span>
                <span className="text-[18px] font-bold text-white tabular-nums">${bundleTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </span>
            ) : (
              <span className="text-[18px] font-bold text-white tabular-nums">${total.toLocaleString()}</span>
            )}
          </div>
          <input
            type="email"
            value={buyerEmail}
            onChange={(e) => setBuyerEmail(e.target.value)}
            placeholder="Your email for the license"
            className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md py-2.5 px-3 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620]"
          />
          <input
            type="text"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            placeholder="Promo code"
            className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md py-2.5 px-3 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] uppercase"
          />
          <button
            onClick={handleCheckout}
            disabled={items.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-[#D4BFA0] hover:bg-[#E8D8B8] disabled:opacity-40 text-black text-[12px] font-bold uppercase tracking-wider transition-all"
          >
            <ShoppingCart size={13} />
            Checkout
          </button>
          <p className="text-[10px] text-[#5a5142] text-center font-mono">
            Secure checkout via Stripe
          </p>
        </div>
      </aside>
    </>
  );
}

/**
 * FloatingCartButton — fixed pill shown on all store pages when the cart
 * has at least one item. Clicking opens the CartDrawer.
 */
export function FloatingCartButton() {
  const { items, isOpen, setIsOpen, cartTotal } = useCart();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted || items.length === 0) return null;

  return (
    <button
      onClick={() => setIsOpen(true)}
      className={`fixed bottom-[7rem] sm:bottom-[8rem] right-4 sm:right-6 z-[70] flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#D4BFA0] hover:bg-[#E8D8B8] text-black shadow-lg shadow-black/40 transition-all ${isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <ShoppingCart size={14} />
      <span className="text-[11px] font-bold uppercase tracking-wider">
        {items.length} · ${cartTotal().toLocaleString()}
      </span>
    </button>
  );
}
