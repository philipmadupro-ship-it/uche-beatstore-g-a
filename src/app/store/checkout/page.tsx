'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ShieldCheck, Loader2, AlertTriangle, ArrowLeft, Mail,
  Check, Lock, RefreshCw, FileText, ShoppingBag, Music, Package,
  Tag, X,
} from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { useCart } from '@/hooks/useCart';
import { getStoreSessionId, trackStoreEvent } from '@/lib/store/track-event';
import { CoverImage } from '@/components/ui/CoverImage';

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

type CheckoutPayload = {
  buyer_email: string;
  store_session_id?: string;
  promo_code?: string;
  project_id?: string;
  items?: Array<{
    track_id: string;
    license_id: string;
    license_type: 'lease' | 'exclusive';
  }>;
};

type StripeCheckoutInstance = {
  mount: (selector: string) => void;
  unmount: () => void;
  destroy: () => void;
};

function CheckoutContent() {
  const { items, cartTotal, bundleRule } = useCart();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState('');
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

    let checkoutInstance: StripeCheckoutInstance | null = null;

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
        }) as StripeCheckoutInstance;

        checkoutInstance.mount('#checkout-element');
      } catch (err) {
        console.error('Stripe mount error:', err);
        // Detect expired / invalid client_secret so we show a friendlier
        // "Refresh checkout" message rather than the raw Stripe error.
        // Stripe surfaces these as messages like "Session has expired"
        // or "no longer valid" when the buyer leaves the tab open
        // past the ~24h session lifetime.
        const message = err instanceof Error ? err.message : 'Failed to render secure payment form.';
        const raw = message.toLowerCase();
        const isExpired = raw.includes('expired') || raw.includes('no longer valid') || raw.includes('invalid');
        if (isExpired) {
          setInitError('Your checkout session expired. Refresh to start a new one.');
          // Clear the dead clientSecret so the retry path re-fetches fresh.
          setClientSecret('');
          setIsEmailSubmitted(false);
        } else {
          setInitError(message);
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
    if (!termsAccepted) {
      setTermsError('Please confirm the license and digital delivery terms before payment.');
      return;
    }
    setTermsError('');
    triggerCheckoutInit(email);
  };

  const triggerCheckoutInit = async (targetEmail: string) => {
    setIsInitializing(true);
    setInitError('');
    setIsEmailSubmitted(true);

    // Save email for future convenience
    localStorage.setItem('antigravity-buyer-email', targetEmail);

    try {
      const payload: CheckoutPayload = {
        buyer_email: targetEmail.trim(),
        store_session_id: getStoreSessionId(),
      };
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
        // Funnel: a Stripe session was created — the buyer reached checkout.
        trackStoreEvent('checkout_start', {
          track_id: isProjectPurchase ? undefined : items[0]?.track.id,
          metadata: {
            mode: isProjectPurchase ? 'project' : 'cart',
            item_count: isProjectPurchase ? 1 : items.length,
            track_ids: isProjectPurchase ? [] : items.map((i) => i.track.id),
            promo: promoTerms ? promoCode.trim().toUpperCase() : undefined,
          },
        });
      } else {
        throw new Error('Stripe initialization failed to return a payment token.');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setInitError(err instanceof Error ? err.message : 'An unexpected error occurred during checkout setup.');
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

  const subtotal = cartTotal();
  const bundleDiscount = bundleRule && items.length >= bundleRule.threshold
    ? subtotal * (Math.min(90, bundleRule.percent) / 100)
    : 0;
  const afterBundle = Math.max(0, subtotal - bundleDiscount);
  const promoDiscount = promoTerms
    ? promoTerms.discount_percent > 0
      ? afterBundle * (promoTerms.discount_percent / 100)
      : Math.min(afterBundle, promoTerms.discount_amount)
    : 0;
  const estimatedTotal = Math.max(items.length * 0.01, afterBundle - promoDiscount);
  const usd = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (items.length === 0 && !isProjectPurchase) {
    return (
      <div className="min-h-screen bg-[#090907] px-6 py-10 text-white">
        <div className="mx-auto flex min-h-[78vh] max-w-xl flex-col items-center justify-center text-center">
          <div className="mb-6 grid size-20 place-items-center rounded-[20px] border border-white/10 bg-white/[0.04]">
            <ShoppingBag size={26} className="text-white/80" />
          </div>
          <p className="mb-3 text-[9px] font-mono uppercase tracking-[0.24em] text-white/40">Checkout</p>
          <h1 className="text-[28px] font-bold leading-tight text-white sm:text-[36px]">Your cart is empty</h1>
          <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-white/60">
            Pick a beat, choose a license, then come back here for instant delivery after payment.
          </p>
          <Link
            href="/store"
            className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-black transition-all hover:bg-white active:scale-[0.98]"
          >
            <ArrowLeft size={13} />
            Browse beats
          </Link>
        </div>
      </div>
    );
  }


  // Computed for the sticky mobile total bar.
  const orderTotalForMobile = isProjectPurchase ? null : estimatedTotal;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-32 pt-6 md:px-8 lg:pb-8">
      <header className="mb-7 rounded-[20px] border border-white/10 bg-white/[0.02] px-5 py-5 md:px-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/store"
              className="mb-4 inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-white/40 transition-colors hover:text-white/80"
            >
              <ArrowLeft size={11} />
              Back to store
            </Link>
            <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-white/40">Secure checkout</p>
            <h1 className="mt-2 text-[28px] font-bold leading-tight text-white sm:text-[36px]">
              {isProjectPurchase ? 'Complete your bundle purchase' : 'License your selected beats'}
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/60">
              Enter your email, pay through Stripe, then receive private download links and license details.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[320px]">
            {[
              { label: 'Email', active: true },
              { label: 'Payment', active: isEmailSubmitted },
              { label: 'Delivery', active: clientSecret },
            ].map((step, index) => (
              <div
                key={step.label}
                className={`rounded-xl border px-3 py-2 ${step.active ? 'border-white/20 bg-white/8 text-white' : 'border-white/[0.05] bg-white/[0.02] text-white/40'}`}
              >
                <p className="text-[9px] font-mono uppercase tracking-[0.18em]">0{index + 1}</p>
                <p className="mt-1 text-[11px] font-semibold">{step.label}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-8 md:gap-12 lg:grid-cols-[minmax(0,1fr)_400px]">

      {/* ── LEFT: Checkout Flow ── */}
      <div className="space-y-6">

        {/* Top Header — back link + secure-checkout badge + guest-checkout tag */}
        <div className="flex items-center justify-end pb-4 border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#6DC6A4] bg-[#6DC6A4]/10 border border-[#6DC6A4]/20 px-2 py-0.5 rounded">
              <Lock size={9} />
              Secure
            </span>
            <span className="hidden sm:inline-flex text-[9px] font-mono uppercase tracking-widest text-white/40 bg-white/[0.02] border border-white/[0.05] px-2 py-0.5 rounded">
              Guest Checkout
            </span>
          </div>
        </div>

        {/* 1. Contact Form */}
        <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-5 transition-all duration-300 md:p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono font-bold border ${isEmailSubmitted ? 'bg-[#6DC6A4]/15 border-[#6DC6A4]/40 text-[#6DC6A4]' : 'bg-white/[0.14] border-white/20 text-white'}`}>
              {isEmailSubmitted ? <Check size={12} /> : '1'}
            </div>
            <div>
              <h2 className="text-[11px] font-mono uppercase tracking-wider text-white">Contact Information</h2>
              <p className="text-[9px] text-white/60">Where to send your purchase and license key</p>
            </div>
          </div>

          {!isEmailSubmitted ? (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label htmlFor="checkout-email" className="block text-[9px] font-mono uppercase tracking-wider text-white/60 mb-2">
                  Email Address <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    id="checkout-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={handleEmailChange}
                    autoComplete="email"
                    inputMode="email"
                    aria-invalid={emailError ? 'true' : 'false'}
                    aria-describedby={emailError ? 'checkout-email-error' : 'checkout-email-help'}
                    className={`w-full bg-[#090907] border rounded-xl py-3 pl-10 pr-4 text-[13px] text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/60 transition-colors ${emailError ? 'border-red-500/50 focus:border-red-500' : 'border-white/10 focus:border-white/20'
                      }`}
                    required
                  />
                </div>
                {emailError && (
                  <p id="checkout-email-error" role="alert" className="text-[9px] text-red-400 mt-2 font-mono flex items-center gap-1">
                    <AlertTriangle size={10} aria-hidden="true" />
                    {emailError}
                  </p>
                )}
                {!emailError && <p id="checkout-email-help" className="sr-only">Your receipt, license, and download link will be sent here.</p>}
              </div>
              <label
                htmlFor="checkout-license-terms"
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${termsError ? 'border-red-500/40 bg-red-950/15' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10]'}`}
              >
                <input
                  id="checkout-license-terms"
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => {
                    setTermsAccepted(e.target.checked);
                    if (e.target.checked) setTermsError('');
                  }}
                  aria-describedby={termsError ? 'checkout-license-terms-error' : 'checkout-license-terms-help'}
                  className="mt-0.5 size-4 shrink-0 accent-white"
                />
                <span className="min-w-0">
                  <span className="block text-[9px] font-mono uppercase tracking-[0.16em] text-white/80">
                    License and delivery terms
                  </span>
                  <span id="checkout-license-terms-help" className="mt-1 block text-[9px] leading-relaxed text-white/40">
                    I understand this is a digital purchase. Track licenses are delivered under the selected tier, project bundles include the listed project tracks, and exclusive availability is verified again before payment is created.
                  </span>
                </span>
              </label>
              {termsError && (
                <p id="checkout-license-terms-error" role="alert" className="text-[9px] text-red-400 font-mono flex items-center gap-1">
                  <AlertTriangle size={10} aria-hidden="true" />
                  {termsError}
                </p>
              )}
              <button
                type="submit"
                disabled={!termsAccepted}
                className="w-full py-3.5 rounded-xl bg-white hover:bg-white active:scale-[0.99] text-black text-[11px] font-bold uppercase tracking-wider transition-all focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Continue to Payment
              </button>
              <p className="text-[9px] text-white/40 text-center pt-1">
                Want to save purchases &amp; favorites?{' '}
                <Link href="/store/account" className="text-white/80 hover:text-white underline underline-offset-2 transition-colors">
                  Create your free U2C account
                </Link>
              </p>
            </form>
          ) : (
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/[0.01] border border-white/[0.03]">
              <div className="flex items-center gap-3">
                <Mail size={14} className="text-white/80" />
                <span className="text-[11px] text-white font-medium">{email}</span>
              </div>
              {!clientSecret && isInitializing ? (
                <Loader2 size={13} className="animate-spin text-white/40" />
              ) : (
                <button
                  onClick={handleResetEmail}
                  className="text-[9px] font-mono uppercase tracking-wider text-white/60 hover:text-white underline transition-colors"
                >
                  Change Email
                </button>
              )}
            </div>
          )}
        </div>

        {/* 2. Payment Section */}
        <div className={`rounded-[20px] border transition-all duration-300 ${isEmailSubmitted ? 'border-white/10 bg-white/[0.04]' : 'border-white/20 bg-white/[0.04]/30 opacity-50 pointer-events-none'
          } p-5 md:p-6`}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-7 h-7 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center text-[11px] font-mono text-white/80 font-bold">
              2
            </div>
            <div>
              <h2 className="text-[11px] font-mono uppercase tracking-wider text-white">Payment Details</h2>
              <p className="text-[9px] text-white/60">Secure, encrypted connection powered by Stripe</p>
            </div>
          </div>

          {/* Missing-key warning wins over the test-mode hint — if the
              env var is missing the publishable key is the sentinel,
              which Stripe will reject, so "test mode" is misleading. */}
          {stripeKeyMissing ? (
            <div className="mb-5 p-3 rounded-xl bg-red-950/30 border border-red-500/30 text-[9px] text-red-300 font-mono leading-relaxed">
              ⚠ <strong>Stripe publishable key missing.</strong> Set
              <code className="mx-1 px-1 bg-red-500/10 rounded">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>
              in the deployment environment. Checkout will not work until this is fixed.
            </div>
          ) : stripePublishableKey.startsWith('pk_test') && (
            <div className="mb-5 p-3 rounded-xl bg-white/10 border border-white/20 text-[9px] text-white/80 font-mono leading-relaxed">
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
              <Loader2 size={24} className="animate-spin text-white" />
              <p className="text-[9px] font-mono text-white/40 uppercase tracking-wider">Securing payment channel…</p>
            </div>
          )}

          {/* Secure embedded element placeholder */}
          <div id="checkout-element" className="min-h-[150px] transition-all duration-300" />

          {clientSecret && !initError && (
            <div className="mt-6 pt-5 border-t border-white/[0.03] flex items-center justify-center gap-2 text-[9px] font-mono text-white/40">
              <Lock size={10} />
              <span>SSL Gated Session · Powered by Stripe Elements</span>
            </div>
          )}
        </div>

      </div>

      {/* ── RIGHT: Order Summary & Trust signals ── */}
      <aside className="space-y-5 lg:sticky lg:top-24">

        {/* Order Summary Box */}
        <div className="flex flex-col overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.04]">
          <div className="px-5 py-4 border-b border-white/[0.04]">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[9px] font-mono uppercase tracking-[0.2em] text-white flex items-center gap-2">
                <ShoppingBag size={12} className="text-white/80" />
                Order summary
              </h3>
              <span className="rounded-full border border-[#6DC6A4]/20 bg-[#6DC6A4]/10 px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider text-[#6DC6A4]">
                Instant delivery
              </span>
            </div>
          </div>

          {/* Item List — tracks for cart purchases, or project summary */}
          {!isProjectPurchase ? (
            <ul className="divide-y divide-white/[0.03] px-5 max-h-[280px] overflow-y-auto">
              {items.map((i) => (
                <li key={i.id} className="py-4 flex gap-3.5 items-start">
                  <div className="relative w-12 h-12 rounded-lg bg-[#090907] border border-white/10 overflow-hidden shrink-0">
                    {i.track.cover_url ? (
                      <CoverImage src={i.track.cover_url} alt="" sizes="48px" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/40">
                        <Music size={16} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-[11px] font-semibold text-white truncate">{i.track.title}</p>
                    <p className="text-[9px] font-mono text-white/60 uppercase tracking-wider">
                      {i.license.name} Tier
                    </p>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-white tabular-nums">
                    ${i.license.price_usd}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-5 bg-[#090907]/30 border-b border-white/[0.04]">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center shrink-0">
                  <Package size={20} className="text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-white">Full Project Bundle</p>
                  <p className="text-[9px] text-white/60 font-mono truncate">Project ID: {projectIdForPurchase.slice(0, 8)}…</p>
                </div>
                <span className="text-[11px] font-mono font-bold text-white">See price in Stripe</span>
              </div>
              <p className="mt-3 text-[9px] text-white/60">All tracks in the project will be delivered with full access via your private link.</p>
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
                  <button type="button" onClick={clearPromo} aria-label="Remove promo code" className="grid size-11 place-items-center text-white/40 hover:text-white transition-colors">
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <label htmlFor="checkout-promo" className="sr-only">Promo code</label>
                  <input
                    id="checkout-promo"
                    type="text"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); checkPromo(); } }}
                    placeholder="Promo code"
                    className="min-h-10 flex-1 rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] uppercase text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
                  />
                  <button
                    onClick={checkPromo}
                    disabled={isCheckingPromo || !promoCode.trim()}
                    className="min-h-10 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[9px] font-mono uppercase tracking-wider text-white transition-colors hover:bg-white/[0.08] disabled:opacity-40"
                  >
                    {isCheckingPromo ? <Loader2 size={10} className="animate-spin" /> : 'Apply'}
                  </button>
                </div>
              )}
              {promoError && (
                <p role="alert" className="text-[9px] text-red-400 mt-1.5">{promoError}</p>
              )}
            </div>
          )}

          {/* Totals (only for track cart; Stripe shows amount for project) */}
          {!isProjectPurchase && (
            <div className="px-5 py-4 bg-[#090907]/40 border-t border-white/[0.04] space-y-1">
              <div className="flex justify-between items-center text-[9px] font-mono text-white/40 uppercase tracking-wider">
                <span>Subtotal</span>
                <span>{usd(subtotal)}</span>
              </div>
              {promoTerms && discountDisplay && (
                <div className="flex justify-between items-center text-[9px] font-mono text-[#6DC6A4] uppercase tracking-wider">
                  <span>Discount ({discountDisplay})</span>
                  <span>-{usd(promoDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-[9px] font-mono text-white/40 uppercase tracking-wider">
                <span>Processing Fee</span>
                <span>$0.00</span>
              </div>
              <div className="flex justify-between items-center pt-2 mt-1 border-t border-white/[0.02]">
                <span className="text-[9px] font-mono text-white/80 uppercase tracking-wider">Total amount</span>
                <span className="text-[18px] font-bold text-white tabular-nums">
                  {usd(estimatedTotal)}
                </span>
              </div>
            </div>
          )}

        </div>

        {/* Accepted payment methods — text badges, no third-party logos so
            we don't pull in brand assets we don't have licenses for. Stripe
            handles all the actual mark rendering inside the iframe. */}
        <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2">Pay with</p>
          <div className="flex flex-wrap gap-1.5">
            {['Visa', 'Mastercard', 'Amex', 'Apple Pay', 'Google Pay', 'Link'].map((m) => (
              <span
                key={m}
                className="px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider text-white/80 bg-white/[0.03] border border-white/[0.06]"
              >
                {m}
              </span>
            ))}
          </div>
          <p className="text-[9px] font-mono text-white/40 mt-2">
            Got a promo code? Apply it in the secure payment form above.
          </p>
        </div>

        {/* Trust & Reassurance Badges */}
        <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-5 space-y-4">
          <h4 className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">Purchase guarantees</h4>

          <div className="space-y-3.5">
            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <Check size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-white">Instant digital delivery</p>
                <p className="text-[9px] text-white/60 leading-relaxed mt-0.5">Receive high-quality audio files (MP3/WAV) immediately after payment.</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <FileText size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-white">Legal license agreement</p>
                <p className="text-[9px] text-white/60 leading-relaxed mt-0.5">Get a PDF contract detailing streaming/distribution rights for your projects.</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <ShieldCheck size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-white">Secure SSL payment</p>
                <p className="text-[9px] text-white/60 leading-relaxed mt-0.5">Transactions processed safely by Stripe. Card numbers are never stored.</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <Lock size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-white">One-time payment</p>
                <p className="text-[9px] text-white/60 leading-relaxed mt-0.5">No recurring fees or monthly subscriptions. Pay once and keep forever.</p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/[0.04] text-center">
            <p className="text-[9px] text-white/40 font-mono leading-relaxed">
              Need assistance? Email us at <br />
              <span className="text-white/80">support@antigravity.fm</span>
            </p>
          </div>
        </div>

      </aside>

      {/* Sticky mobile total bar — surfaces the order total below the fold
          on small screens where the order-summary column is collapsed. The
          extra pb-32 on the grid above reserves the space so the bar
          doesn't cover the last form fields. */}
      <div className="lg:hidden fixed left-0 right-0 bottom-0 z-30 bg-[#090907]/95 backdrop-blur border-t border-white/10 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center justify-between gap-3" role="status" aria-live="polite">
        <div className="min-w-0">
          <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">
            {isProjectPurchase ? 'Project bundle' : `${items.length} item${items.length === 1 ? '' : 's'}`}
          </p>
          <p className="text-[18px] font-bold text-white tabular-nums leading-tight">
            {orderTotalForMobile != null ? usd(orderTotalForMobile) : 'See Stripe'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[#6DC6A4]">
            <Lock size={9} />
            SSL
          </span>
          <span className="text-[9px] font-mono uppercase tracking-widest text-white/40">
            {clientSecret ? 'Pay in form ↑' : isEmailSubmitted ? 'Loading…' : 'Enter email ↑'}
          </span>
        </div>
      </div>

    </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <div className="min-h-screen bg-[#090907] text-white pt-4 pb-20">
      <Suspense fallback={
        <div className="min-h-[70vh] flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-white/40" />
        </div>
      }>
        <CheckoutContent />
      </Suspense>
    </div>
  );
}
