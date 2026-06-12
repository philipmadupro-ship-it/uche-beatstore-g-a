'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ShieldCheck, Loader2, AlertTriangle, ArrowLeft, Mail,
  Check, Lock, RefreshCw, FileText, ShoppingBag, Music, Package,
  Tag, X,
} from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { useCart } from '@/hooks/useCart';

// Load Stripe. The previous fallback hardcoded a real `pk_test_…` from
// another Stripe account, which would silently route payments to that
// account if NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY was missing in prod.
// The sentinel below is a clearly-invalid key Stripe rejects on first
// request, so a missing env var fails LOUDLY instead of silently
// charging the wrong account. The boolean below flips the "test mode"
// banner off in that broken state so the user isn't misled into
// trying to test.
const PK_MISSING_SENTINEL = 'pk_test_MISSING_SET_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY';
const stripePublishableKey =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || PK_MISSING_SENTINEL;
const stripeKeyMissing = stripePublishableKey === PK_MISSING_SENTINEL;
const stripePromise = loadStripe(stripePublishableKey);

function CheckoutContent() {
  const { items, cartTotal, clearCart } = useCart();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [isInitializing, setIsInitializing] = useState(false);
  const [clientSecret, setClientSecret] = useState('');
  const [initError, setInitError] = useState('');
  const [isEmailSubmitted, setIsEmailSubmitted] = useState(false);
  const [isProjectPurchase, setIsProjectPurchase] = useState(false);
  const [projectIdForPurchase, setProjectIdForPurchase] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoError, setPromoError] = useState('');
  const [promoTerms, setPromoTerms] = useState<{ discount_percent: number; discount_amount: number } | null>(null);
  const [isCheckingPromo, setIsCheckingPromo] = useState(false);

  // Try to prefill email from query params or localStorage
  // Also detect direct project purchase (from store page "Buy entire project")
  useEffect(() => {
    const pId = searchParams?.get('project_id');
    if (pId) {
      setIsProjectPurchase(true);
      setProjectIdForPurchase(pId);
    }
    const queryEmail = searchParams?.get('email');
    if (queryEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(queryEmail)) {
      setEmail(queryEmail);
    } else {
      const storedEmail = localStorage.getItem('antigravity-buyer-email');
      if (storedEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(storedEmail)) {
        setEmail(storedEmail);
      }
    }
    const queryPromo = searchParams?.get('promo');
    if (queryPromo) {
      setPromoCode(queryPromo);
    }
  }, [searchParams]);

  // Mount Stripe Embedded Checkout when clientSecret changes
  useEffect(() => {
    if (!clientSecret) return;

    let checkoutInstance: any = null;

    async function mountStripeCheckout() {
      try {
        const stripe = await stripePromise;
        if (!stripe) {
          setInitError('Stripe SDK failed to load. Please check your network connection.');
          return;
        }

        // `initEmbeddedCheckout` was removed in @stripe/stripe-js >= 9.x;
        // the current method for sessions created with
        // `ui_mode: 'embedded_page'` server-side is `createEmbeddedCheckoutPage`.
        // Typed call (no `as any`) so the next SDK rename surfaces at compile
        // time instead of throwing in the browser.
        checkoutInstance = await stripe.createEmbeddedCheckoutPage({
          clientSecret,
        });

        checkoutInstance.mount('#checkout-element');
      } catch (err: any) {
        console.error('Stripe mount error:', err);
        // Detect expired / invalid client_secret so we show a friendlier
        // "Refresh checkout" message rather than the raw Stripe error.
        // Stripe surfaces these as messages like "Session has expired"
        // or "no longer valid" when the buyer leaves the tab open
        // past the ~24h session lifetime.
        const raw = String(err?.message ?? '').toLowerCase();
        const isExpired = raw.includes('expired') || raw.includes('no longer valid') || raw.includes('invalid');
        if (isExpired) {
          setInitError('Your checkout session expired. Refresh to start a new one.');
          // Clear the dead clientSecret so the retry path re-fetches fresh.
          setClientSecret('');
          setIsEmailSubmitted(false);
        } else {
          setInitError(err.message || 'Failed to render secure payment form.');
        }
      }
    }

    mountStripeCheckout();

    return () => {
      if (checkoutInstance) {
        checkoutInstance.unmount();
        checkoutInstance.destroy();
      }
    };
  }, [clientSecret]);

  const validateEmail = (val: string) => {
    if (!val) {
      return 'Email is required';
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) {
      return 'Please enter a valid email address';
    }
    return '';
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEmail(val);
    if (emailError) {
      setEmailError(validateEmail(val));
    }
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateEmail(email);
    if (err) {
      setEmailError(err);
      return;
    }
    triggerCheckoutInit(email);
  };

  const triggerCheckoutInit = async (targetEmail: string) => {
    setIsInitializing(true);
    setInitError('');
    setIsEmailSubmitted(true);

    // Save email for future convenience
    localStorage.setItem('antigravity-buyer-email', targetEmail);

    try {
      const payload: any = { buyer_email: targetEmail.trim() };
      if (promoTerms) {
        payload.promo_code = promoCode.trim().toUpperCase();
      }
      if (isProjectPurchase && projectIdForPurchase) {
        payload.project_id = projectIdForPurchase;
      } else {
        // Include license_id so the server can resolve custom license tiers
        // from the database instead of relying on the legacy type string only.
        payload.items = items.map((i) => ({
          track_id: i.track.id,
          license_id: i.license.id,
          license_type: i.license.is_exclusive ? 'exclusive' : 'lease',
        }));
      }

      const res = await fetch('/api/store/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server error: ${res.status}`);
      }

      if (data.client_secret) {
        setClientSecret(data.client_secret);
      } else {
        throw new Error('Stripe initialization failed to return a payment token.');
      }
    } catch (err: any) {
      console.error('Checkout error:', err);
      setInitError(err.message || 'An unexpected error occurred during checkout setup.');
      setIsEmailSubmitted(false);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleResetEmail = () => {
    setClientSecret('');
    setIsEmailSubmitted(false);
    setInitError('');
  };

  const checkPromo = async () => {
    const code = promoCode.trim().toUpperCase();
    if (!code) { setPromoError(''); setPromoTerms(null); return; }
    setIsCheckingPromo(true);
    setPromoError('');
    try {
      const res = await fetch('/api/store/promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!data.valid) {
        setPromoError(data.error || 'Invalid code');
        setPromoTerms(null);
      } else {
        setPromoTerms({ discount_percent: data.discount_percent, discount_amount: data.discount_amount });
      }
    } catch {
      setPromoError('Could not validate code');
      setPromoTerms(null);
    } finally {
      setIsCheckingPromo(false);
    }
  };

  const clearPromo = () => {
    setPromoCode('');
    setPromoError('');
    setPromoTerms(null);
  };

  const discountDisplay = (() => {
    if (!promoTerms) return null;
    if (promoTerms.discount_percent > 0) return `${promoTerms.discount_percent}% off`;
    if (promoTerms.discount_amount > 0) return `$${promoTerms.discount_amount} off`;
    return null;
  })();

  if (items.length === 0 && !isProjectPurchase) {
    return (
      <div className="min-h-screen bg-[#090907] flex items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-[16px] font-bold text-white uppercase tracking-wider mb-2">Your Cart is Empty</h1>
          <p className="text-[#B4AA99] text-[12px] mb-6">Add tracks from the store to purchase licenses.</p>
          <Link href="/store" className="text-[#E7D7BE] hover:text-white text-[11px] font-mono uppercase tracking-wider">← Back to store</Link>
        </div>
      </div>
    );
  }


  // Computed for the sticky mobile total bar.
  const orderTotalForMobile = isProjectPurchase ? null : cartTotal();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 md:gap-12 items-start max-w-6xl mx-auto px-4 md:px-8 py-6 pb-32 lg:pb-6">

      {/* ── LEFT: Checkout Flow ── */}
      <div className="space-y-6">

        {/* Top Header — back link + secure-checkout badge + guest-checkout tag */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.04]">
          <Link
            href="/store"
            className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#9B9282] hover:text-[#D0C3AF] transition-colors"
          >
            <ArrowLeft size={11} />
            Back to store
          </Link>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 px-2 py-0.5 rounded">
              <Lock size={9} />
              Secure
            </span>
            <span className="hidden sm:inline-flex text-[9px] font-mono uppercase tracking-widest text-[#6E685B] bg-white/[0.02] border border-white/[0.05] px-2 py-0.5 rounded">
              Guest Checkout
            </span>
          </div>
        </div>

        {/* 1. Contact Form */}
        <div className="rounded-2xl border border-[#2B2821] bg-[#171511] p-5 md:p-6 transition-all duration-300">
          <div className="flex items-center gap-3 mb-5">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono font-bold ${isEmailSubmitted ? 'bg-[#6DC6A4] text-black' : 'bg-[#E7D7BE] text-black'}`}>
              {isEmailSubmitted ? <Check size={12} /> : '1'}
            </div>
            <div>
              <h2 className="text-[12px] font-mono uppercase tracking-wider text-white">Contact Information</h2>
              <p className="text-[10px] text-[#B4AA99]">Where to send your purchase and license key</p>
            </div>
          </div>

          {!isEmailSubmitted ? (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label htmlFor="checkout-email" className="block text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] mb-2">
                  Email Address <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6E685B]" />
                  <input
                    id="checkout-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={handleEmailChange}
                    className={`w-full bg-[#090907] border rounded-xl py-3 pl-10 pr-4 text-[13px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none transition-colors ${emailError ? 'border-red-500/50 focus:border-red-500' : 'border-[#2B2821] focus:border-[#3B372F]'
                      }`}
                    required
                  />
                </div>
                {emailError && (
                  <p className="text-[10px] text-red-400 mt-2 font-mono flex items-center gap-1">
                    <AlertTriangle size={10} />
                    {emailError}
                  </p>
                )}
              </div>
              <button
                type="submit"
                className="w-full py-3.5 rounded-xl bg-[#E7D7BE] hover:bg-[#F3E6D1] active:scale-[0.99] text-black text-[11px] font-bold uppercase tracking-wider transition-all"
              >
                Continue to Payment
              </button>
              <p className="text-[10px] text-[#9B9282] text-center pt-1">
                Want to save purchases &amp; favorites?{' '}
                <Link href="/store/account" className="text-[#D0C3AF] hover:text-[#F7EBDD] underline underline-offset-2 transition-colors">
                  Create your free U2C account
                </Link>
              </p>
            </form>
          ) : (
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/[0.01] border border-white/[0.03]">
              <div className="flex items-center gap-3">
                <Mail size={14} className="text-[#D0C3AF]" />
                <span className="text-[12px] text-[#F7EBDD] font-medium">{email}</span>
              </div>
              {!clientSecret && isInitializing ? (
                <Loader2 size={13} className="animate-spin text-[#9B9282]" />
              ) : (
                <button
                  onClick={handleResetEmail}
                  className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] hover:text-[#F7EBDD] underline transition-colors"
                >
                  Change Email
                </button>
              )}
            </div>
          )}
        </div>

        {/* 2. Payment Section */}
        <div className={`rounded-2xl border transition-all duration-300 ${isEmailSubmitted ? 'border-[#2B2821] bg-[#171511]' : 'border-[#2B2821]/30 bg-[#171511]/30 opacity-50 pointer-events-none'
          } p-5 md:p-6`}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-7 h-7 rounded-full bg-[#171511] border border-[#2B2821] flex items-center justify-center text-[11px] font-mono text-[#D0C3AF] font-bold">
              2
            </div>
            <div>
              <h2 className="text-[12px] font-mono uppercase tracking-wider text-white">Payment Details</h2>
              <p className="text-[10px] text-[#B4AA99]">Secure, encrypted connection powered by Stripe</p>
            </div>
          </div>

          {/* Missing-key warning wins over the test-mode hint — if the
              env var is missing the publishable key is the sentinel,
              which Stripe will reject, so "test mode" is misleading. */}
          {stripeKeyMissing ? (
            <div className="mb-5 p-3 rounded-xl bg-red-950/30 border border-red-500/30 text-[10px] text-red-300 font-mono leading-relaxed">
              ⚠ <strong>Stripe publishable key missing.</strong> Set
              <code className="mx-1 px-1 bg-red-500/10 rounded">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>
              in the deployment environment. Checkout will not work until this is fixed.
            </div>
          ) : stripePublishableKey.startsWith('pk_test') && (
            <div className="mb-5 p-3 rounded-xl bg-[#342F27]/60 border border-[#E7D7BE]/10 text-[10px] text-[#D0C3AF] font-mono leading-relaxed">
              💡 <strong>Test Mode Active:</strong> You can complete purchases using Stripe test cards (e.g. 4242 4242 4242 4242).
            </div>
          )}

          {initError && (() => {
            const isExpired = initError.toLowerCase().includes('expired');
            return (
              <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/20 text-red-300 text-[11px] font-mono mb-5 flex items-start gap-2.5">
                <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-400" />
                <div className="space-y-2">
                  <p>{initError}</p>
                  <button
                    onClick={() => triggerCheckoutInit(email)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 hover:bg-red-500/20 rounded border border-red-500/30 text-[9px] uppercase tracking-wider transition-colors"
                  >
                    <RefreshCw size={10} /> {isExpired ? 'Refresh checkout' : 'Retry setup'}
                  </button>
                </div>
              </div>
            );
          })()}

          {isEmailSubmitted && isInitializing && (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 size={24} className="animate-spin text-[#E7D7BE]" />
              <p className="text-[10px] font-mono text-[#9B9282] uppercase tracking-wider">Securing payment channel…</p>
            </div>
          )}

          {/* Secure embedded element placeholder */}
          <div id="checkout-element" className="transition-all duration-300 min-h-[150px]" />

          {clientSecret && !initError && (
            <div className="mt-6 pt-5 border-t border-white/[0.03] flex items-center justify-center gap-2 text-[10px] font-mono text-[#6E685B]">
              <Lock size={10} />
              <span>SSL Gated Session · Powered by Stripe Elements</span>
            </div>
          )}
        </div>

      </div>

      {/* ── RIGHT: Order Summary & Trust signals ── */}
      <div className="space-y-5 lg:sticky lg:top-24">

        {/* Order Summary Box */}
        <div className="rounded-2xl border border-[#2B2821] bg-[#171511] overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-white/[0.04]">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#F7EBDD] flex items-center gap-2">
              <ShoppingBag size={12} className="text-[#D0C3AF]" />
              Order Summary
            </h3>
          </div>

          {/* Item List — tracks for cart purchases, or project summary */}
          {!isProjectPurchase ? (
            <ul className="divide-y divide-white/[0.03] px-5 max-h-[280px] overflow-y-auto">
              {items.map((i) => (
                <li key={i.id} className="py-4 flex gap-3.5 items-start">
                  <div className="w-12 h-12 rounded-lg bg-[#090907] border border-[#2B2821] overflow-hidden shrink-0">
                    {i.track.cover_url ? (
                      <img loading="lazy" src={i.track.cover_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#6E685B]">
                        <Music size={16} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-[12px] font-semibold text-white truncate">{i.track.title}</p>
                    <p className="text-[9px] font-mono text-[#B4AA99] uppercase tracking-wider">
                      {i.license.name} Tier
                    </p>
                  </div>
                  <span className="text-[12px] font-mono font-bold text-white tabular-nums">
                    ${i.license.price_usd}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-5 bg-[#090907]/30 border-b border-white/[0.04]">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-[#171511] border border-[#2B2821] flex items-center justify-center shrink-0">
                  <Package size={20} className="text-[#E7D7BE]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-white">Full Project Bundle</p>
                  <p className="text-[10px] text-[#B4AA99] font-mono truncate">Project ID: {projectIdForPurchase.slice(0, 8)}…</p>
                </div>
                <span className="text-[12px] font-mono font-bold text-[#E7D7BE]">See price in Stripe</span>
              </div>
              <p className="mt-3 text-[10px] text-[#B4AA99]">All tracks in the project will be delivered with full access via your private link.</p>
            </div>
          )}


          {/* Promo code */}
          {!isProjectPurchase && (
            <div className="px-5 py-3 bg-[#090907]/30 border-t border-white/[0.04]">
              {promoTerms ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Tag size={12} className="text-[#6DC6A4]" />
                    <span className="text-[11px] font-mono text-[#6DC6A4]">
                      {promoCode.trim().toUpperCase()} — {discountDisplay}
                    </span>
                  </div>
                  <button onClick={clearPromo} className="text-[#9B9282] hover:text-white transition-colors">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); checkPromo(); } }}
                    placeholder="Promo code"
                    className="flex-1 bg-[#090907] border border-[#2B2821] rounded-lg py-2 px-3 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F] uppercase"
                  />
                  <button
                    onClick={checkPromo}
                    disabled={isCheckingPromo || !promoCode.trim()}
                    className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[10px] font-mono uppercase tracking-wider text-[#F7EBDD] hover:bg-white/[0.08] disabled:opacity-40 transition-colors"
                  >
                    {isCheckingPromo ? <Loader2 size={10} className="animate-spin" /> : 'Apply'}
                  </button>
                </div>
              )}
              {promoError && (
                <p className="text-[10px] text-red-400 mt-1.5">{promoError}</p>
              )}
            </div>
          )}

          {/* Totals (only for track cart; Stripe shows amount for project) */}
          {!isProjectPurchase && (
            <div className="px-5 py-4 bg-[#090907]/40 border-t border-white/[0.04] space-y-1">
              <div className="flex justify-between items-center text-[10px] font-mono text-[#9B9282] uppercase tracking-wider">
                <span>Subtotal</span>
                <span>${cartTotal()}</span>
              </div>
              {promoTerms && discountDisplay && (
                <div className="flex justify-between items-center text-[10px] font-mono text-[#6DC6A4] uppercase tracking-wider">
                  <span>Discount ({discountDisplay})</span>
                  <span>-{discountDisplay}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-[10px] font-mono text-[#9B9282] uppercase tracking-wider">
                <span>Processing Fee</span>
                <span>$0.00</span>
              </div>
              <div className="flex justify-between items-center pt-2 mt-1 border-t border-white/[0.02]">
                <span className="text-[10px] font-mono text-[#D0C3AF] uppercase tracking-wider">Total amount</span>
                <span className="text-[18px] font-bold text-white tabular-nums">
                  ${cartTotal()}
                </span>
              </div>
            </div>
          )}

        </div>

        {/* Accepted payment methods — text badges, no third-party logos so
            we don't pull in brand assets we don't have licenses for. Stripe
            handles all the actual mark rendering inside the iframe. */}
        <div className="rounded-2xl border border-[#2B2821] bg-[#171511] p-4">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-2">Pay with</p>
          <div className="flex flex-wrap gap-1.5">
            {['Visa', 'Mastercard', 'Amex', 'Apple Pay', 'Google Pay', 'Link'].map((m) => (
              <span
                key={m}
                className="px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider text-[#D0C3AF] bg-white/[0.03] border border-white/[0.06]"
              >
                {m}
              </span>
            ))}
          </div>
          <p className="text-[9px] font-mono text-[#6E685B] mt-2">
            Got a promo code? Apply it in the secure payment form above.
          </p>
        </div>

        {/* Trust & Reassurance Badges */}
        <div className="rounded-2xl border border-[#2B2821] bg-[#171511] p-5 space-y-4">
          <h4 className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282]">Purchase Guarantees</h4>

          <div className="space-y-3.5">
            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <Check size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#F7EBDD]">Instant Digital Delivery</p>
                <p className="text-[9px] text-[#B4AA99] leading-relaxed mt-0.5">Receive high-quality audio files (MP3/WAV) immediately after payment.</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <FileText size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#F7EBDD]">Legal License Agreement</p>
                <p className="text-[9px] text-[#B4AA99] leading-relaxed mt-0.5">Get a PDF contract detailing streaming/distribution rights for your projects.</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <ShieldCheck size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#F7EBDD]">Secure SSL Payment</p>
                <p className="text-[9px] text-[#B4AA99] leading-relaxed mt-0.5">Transactions processed safely by Stripe. Card numbers are never stored.</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <Lock size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#F7EBDD]">One-Time Payment</p>
                <p className="text-[9px] text-[#B4AA99] leading-relaxed mt-0.5">No recurring fees or monthly subscriptions. Pay once and keep forever.</p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/[0.04] text-center">
            <p className="text-[10px] text-[#9B9282] font-mono leading-relaxed">
              Need assistance? Email us at <br />
              <span className="text-[#D0C3AF]">support@antigravity.fm</span>
            </p>
          </div>
        </div>

      </div>

      {/* Sticky mobile total bar — surfaces the order total below the fold
          on small screens where the order-summary column is collapsed. The
          extra pb-32 on the grid above reserves the space so the bar
          doesn't cover the last form fields. */}
      <div className="lg:hidden fixed left-0 right-0 bottom-0 z-30 bg-[#090907]/95 backdrop-blur border-t border-[#2B2821] px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#9B9282]">
            {isProjectPurchase ? 'Project bundle' : `${items.length} item${items.length === 1 ? '' : 's'}`}
          </p>
          <p className="text-[18px] font-bold text-white tabular-nums leading-tight">
            {orderTotalForMobile != null ? `$${orderTotalForMobile}` : 'See Stripe'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[#6DC6A4]">
            <Lock size={9} />
            SSL
          </span>
          <span className="text-[9px] font-mono uppercase tracking-widest text-[#9B9282]">
            {clientSecret ? 'Pay in form ↑' : isEmailSubmitted ? 'Loading…' : 'Enter email ↑'}
          </span>
        </div>
      </div>

    </div>
  );
}

export default function CheckoutPage() {
  return (
    <div className="min-h-screen bg-[#090907] text-[#F7EBDD] pt-4 pb-20">
      <Suspense fallback={
        <div className="min-h-[70vh] flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-[#9B9282]" />
        </div>
      }>
        <CheckoutContent />
      </Suspense>
    </div>
  );
}
