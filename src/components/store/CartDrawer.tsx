'use client';

/**
 * CartDrawer — slide-in purchase cart shared across all /store/* pages.
 *
 * Reads cart state from the global useCart store and fires the Stripe
 * checkout API on submit. Extracted from store/page.tsx so it can be
 * mounted once in the store layout rather than duplicated per page.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, X, Music } from 'lucide-react';
import { useCart } from '@/hooks/useCart';
import { useHydrated } from '@/hooks/useHydrated';
import type { Track } from '@/lib/types';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';

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
  const mounted = useHydrated();
  const bundleRule = useCart((s) => s.bundleRule);
  const items = mounted ? rawItems : [];
  const total = mounted ? rawTotal : 0;

  // Automatic bundle/quantity discount preview (Task 7). The server is the
  // source of truth at checkout; this just shows the buyer the deal early.
  const bundleQualifies = !!bundleRule && bundleRule.percent > 0 && items.length >= bundleRule.threshold;
  const bundleTotal = bundleQualifies ? total * (1 - bundleRule!.percent / 100) : total;

  useEffect(() => {
    if (!mounted) return;
    const stored = localStorage.getItem('antigravity-buyer-email');
    if (!stored) return;
    const frame = requestAnimationFrame(() => setBuyerEmail(stored));
    return () => cancelAnimationFrame(frame);
  }, [mounted]);

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
    <Drawer
      open={open}
      onClose={onClose}
      title={`Cart · ${items.length}`}
      icon={<ShoppingCart size={16} aria-hidden="true" />}
      side="right"
      size="md"
      className="bg-gradient-to-b from-[#101012]/95 via-[var(--bg-page)]/95 to-[var(--bg-page)]/95 backdrop-blur-2xl"
      contentClassName="px-3 py-3"
      footer={(
        <div className="space-y-3">
          {bundleQualifies && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#6DC6A4]/10 border border-[#6DC6A4]/30">
              <span className="text-[11px] font-semibold text-[#6DC6A4]">Bundle deal applied</span>
              <span className="text-[11px] font-mono font-bold text-[#6DC6A4]">-{bundleRule!.percent}%</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#B4AA99]">Total</span>
            {bundleQualifies ? (
              <span className="flex items-baseline gap-2">
                <span className="text-[12px] font-mono text-[#9B9282] line-through tabular-nums">${total.toLocaleString()}</span>
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
            className="w-full bg-[#090907] border border-[#2B2821] rounded-md py-2.5 px-3 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F]"
          />
          <input
            type="text"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            placeholder="Promo code"
            className="w-full bg-[#090907] border border-[#2B2821] rounded-md py-2.5 px-3 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F] uppercase"
          />
          <Button
            onClick={handleCheckout}
            disabled={items.length === 0}
            variant="primary"
            className="w-full"
          >
            <ShoppingCart size={13} />
            Checkout
          </Button>
          <p className="text-[10px] text-[#9B9282] text-center font-mono">
            Secure checkout via Stripe
          </p>
        </div>
      )}
    >
      {items.length === 0 ? (
        <div className="text-center py-16 text-[#9B9282] text-[12px]">Cart empty</div>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li
              key={i.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]"
            >
              <div className="w-10 h-10 rounded bg-[#090907] border border-[#2B2821] overflow-hidden shrink-0">
                {i.track.cover_url
                  ? <img loading="lazy" src={i.track.cover_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-[#6E685B]"><Music size={14} /></div>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-[#F7EBDD] truncate">{i.track.title}</p>
                <p className="text-[10px] font-mono text-[#B4AA99] uppercase tracking-wider mt-0.5">
                  {i.license.name} · ${i.license.price_usd.toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => removeItem(i.id)}
                className="tap flex size-9 shrink-0 items-center justify-center rounded-full text-[#B4AA99] transition-colors hover:bg-white/[0.06] hover:text-red-400"
                aria-label={`Remove ${i.track.title} from cart`}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

/**
 * FloatingCartButton — fixed pill shown on all store pages when the cart
 * has at least one item. Clicking opens the CartDrawer.
 */
export function FloatingCartButton() {
  const { items, isOpen, setIsOpen, cartTotal } = useCart();
  const mounted = useHydrated();

  if (!mounted || items.length === 0) return null;

  return (
    <button
      onClick={() => setIsOpen(true)}
      className={`fixed bottom-[7rem] sm:bottom-[8rem] right-4 sm:right-6 z-[70] flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#E7D7BE] hover:bg-[#F3E6D1] text-black shadow-lg shadow-black/40 transition-all ${isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <ShoppingCart size={14} />
      <span className="text-[11px] font-bold uppercase tracking-wider">
        {items.length} · ${cartTotal().toLocaleString()}
      </span>
    </button>
  );
}
