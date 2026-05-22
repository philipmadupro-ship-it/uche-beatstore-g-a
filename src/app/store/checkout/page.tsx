'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ShieldCheck, Loader2, AlertTriangle, ArrowLeft, Mail,
  Check, Lock, RefreshCw, FileText, ShoppingBag, Music, Package,
} from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { useCart } from '@/hooks/useCart';

// Load Stripe. Fallback to a placeholder in dev if not set to prevent crashing
const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_51TYTBb2NNv7qe8ftKQFdtdthCaiwwb8qqRqljC0fpKmpOqyKkyiYya3JqmHT6txvu7kqF9B26u6JpSIhJB9L9DGX00Jlp1pqaB';
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
      triggerCheckoutInit(queryEmail);
    } else {
      const storedEmail = localStorage.getItem('antigravity-buyer-email');
      if (storedEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(storedEmail)) {
        setEmail(storedEmail);
      }
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

        checkoutInstance = await (stripe as any).initEmbeddedCheckout({
          clientSecret,
        });
        
        checkoutInstance.mount('#checkout-element');
      } catch (err: any) {
        console.error('Stripe mount error:', err);
        setInitError(err.message || 'Failed to render secure payment form.');
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

  if (items.length === 0 && !isProjectPurchase) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-[16px] font-bold text-white uppercase tracking-wider mb-2">Your Cart is Empty</h1>
          <p className="text-[#6a5d4a] text-[12px] mb-6">Add tracks from the store to purchase licenses.</p>
          <Link href="/store" className="text-[#D4BFA0] hover:text-white text-[11px] font-mono uppercase tracking-wider">← Back to store</Link>
        </div>
      </div>
    );
  }


  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 md:gap-12 items-start max-w-6xl mx-auto px-4 md:px-8 py-6">
      
      {/* ── LEFT: Checkout Flow ── */}
      <div className="space-y-6">
        
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.04]">
          <Link
            href="/store"
            className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#5a5142] hover:text-[#a08a6a] transition-colors"
          >
            <ArrowLeft size={11} />
            Back to store
          </Link>
          <span className="text-[9px] font-mono uppercase tracking-widest text-[#3a3328] bg-white/[0.02] border border-white/[0.05] px-2 py-0.5 rounded">
            Guest Checkout
          </span>
        </div>

        {/* 1. Contact Form */}
        <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] p-5 md:p-6 transition-all duration-300">
          <div className="flex items-center gap-3 mb-5">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono font-bold ${isEmailSubmitted ? 'bg-[#6DC6A4] text-black' : 'bg-[#D4BFA0] text-black'}`}>
              {isEmailSubmitted ? <Check size={12} /> : '1'}
            </div>
            <div>
              <h2 className="text-[12px] font-mono uppercase tracking-wider text-white">Contact Information</h2>
              <p className="text-[10px] text-[#6a5d4a]">Where to send your purchase and license key</p>
            </div>
          </div>

          {!isEmailSubmitted ? (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label htmlFor="checkout-email" className="block text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a] mb-2">
                  Email Address <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#3a3328]" />
                  <input
                    id="checkout-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={handleEmailChange}
                    className={`w-full bg-[#0a0907] border rounded-xl py-3 pl-10 pr-4 text-[13px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none transition-colors ${
                      emailError ? 'border-red-500/50 focus:border-red-500' : 'border-[#1f1a13] focus:border-[#2d2620]'
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
                className="w-full py-3.5 rounded-xl bg-[#D4BFA0] hover:bg-[#E8D8B8] active:scale-[0.99] text-black text-[11px] font-bold uppercase tracking-wider transition-all"
              >
                Continue to Payment
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/[0.01] border border-white/[0.03]">
              <div className="flex items-center gap-3">
                <Mail size={14} className="text-[#a08a6a]" />
                <span className="text-[12px] text-[#E8DCC8] font-medium">{email}</span>
              </div>
              {!clientSecret && isInitializing ? (
                <Loader2 size={13} className="animate-spin text-[#5a5142]" />
              ) : (
                <button
                  onClick={handleResetEmail}
                  className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a] hover:text-[#E8DCC8] underline transition-colors"
                >
                  Change Email
                </button>
              )}
            </div>
          )}
        </div>

        {/* 2. Payment Section */}
        <div className={`rounded-2xl border transition-all duration-300 ${
          isEmailSubmitted ? 'border-[#1f1a13] bg-[#14110d]' : 'border-[#1f1a13]/30 bg-[#14110d]/30 opacity-50 pointer-events-none'
        } p-5 md:p-6`}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-7 h-7 rounded-full bg-[#14110d] border border-[#1f1a13] flex items-center justify-center text-[11px] font-mono text-[#a08a6a] font-bold">
              2
            </div>
            <div>
              <h2 className="text-[12px] font-mono uppercase tracking-wider text-white">Payment Details</h2>
              <p className="text-[10px] text-[#6a5d4a]">Secure, encrypted connection powered by Stripe</p>
            </div>
          </div>

          {/* Warning about testing if publishable key seems standard/mocked */}
          {stripePublishableKey.startsWith('pk_test') && (
            <div className="mb-5 p-3 rounded-xl bg-[#2A2418]/60 border border-[#D4BFA0]/10 text-[10px] text-[#a08a6a] font-mono leading-relaxed">
              💡 <strong>Test Mode Active:</strong> You can complete purchases using Stripe test cards (e.g. 4242 4242 4242 4242).
            </div>
          )}

          {initError && (
            <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/20 text-red-300 text-[11px] font-mono mb-5 flex items-start gap-2.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-400" />
              <div className="space-y-2">
                <p>{initError}</p>
                <button
                  onClick={() => triggerCheckoutInit(email)}
                  className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 hover:bg-red-500/20 rounded border border-red-500/30 text-[9px] uppercase tracking-wider transition-colors"
                >
                  <RefreshCw size={10} /> Retry setup
                </button>
              </div>
            </div>
          )}

          {isEmailSubmitted && isInitializing && (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 size={24} className="animate-spin text-[#D4BFA0]" />
              <p className="text-[10px] font-mono text-[#5a5142] uppercase tracking-wider">Securing payment channel…</p>
            </div>
          )}

          {/* Secure embedded element placeholder */}
          <div id="checkout-element" className="transition-all duration-300 min-h-[150px]" />
          
          {clientSecret && !initError && (
            <div className="mt-6 pt-5 border-t border-white/[0.03] flex items-center justify-center gap-2 text-[10px] font-mono text-[#3a3328]">
              <Lock size={10} />
              <span>SSL Gated Session · Powered by Stripe Elements</span>
            </div>
          )}
        </div>

      </div>

      {/* ── RIGHT: Order Summary & Trust signals ── */}
      <div className="space-y-5 lg:sticky lg:top-24">
        
        {/* Order Summary Box */}
        <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-white/[0.04]">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#E8DCC8] flex items-center gap-2">
              <ShoppingBag size={12} className="text-[#a08a6a]" />
              Order Summary
            </h3>
          </div>

           {/* Item List — tracks for cart purchases, or project summary */}
           {!isProjectPurchase ? (
             <ul className="divide-y divide-white/[0.03] px-5 max-h-[280px] overflow-y-auto">
               {items.map((i) => (
                 <li key={i.id} className="py-4 flex gap-3.5 items-start">
                   <div className="w-12 h-12 rounded-lg bg-[#0a0907] border border-[#1f1a13] overflow-hidden shrink-0">
                     {i.track.cover_url ? (
                       <img loading="lazy" src={i.track.cover_url} alt="" className="w-full h-full object-cover" />
                     ) : (
                       <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
                         <Music size={16} />
                       </div>
                     )}
                   </div>
                   <div className="min-w-0 flex-1 space-y-0.5">
                     <p className="text-[12px] font-semibold text-white truncate">{i.track.title}</p>
                     <p className="text-[9px] font-mono text-[#6a5d4a] uppercase tracking-wider">
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
             <div className="px-5 py-5 bg-[#0a0907]/30 border-b border-white/[0.04]">
               <div className="flex items-center gap-3">
                 <div className="w-12 h-12 rounded-lg bg-[#14110d] border border-[#1f1a13] flex items-center justify-center shrink-0">
                   <Package size={20} className="text-[#D4BFA0]" />
                 </div>
                 <div className="min-w-0 flex-1">
                   <p className="text-[12px] font-semibold text-white">Full Project Bundle</p>
                   <p className="text-[10px] text-[#6a5d4a] font-mono truncate">Project ID: {projectIdForPurchase.slice(0, 8)}…</p>
                 </div>
                 <span className="text-[12px] font-mono font-bold text-[#D4BFA0]">See price in Stripe</span>
               </div>
               <p className="mt-3 text-[10px] text-[#6a5d4a]">All tracks in the project will be delivered with full access via your private link.</p>
             </div>
           )}


           {/* Totals (only for track cart; Stripe shows amount for project) */}
           {!isProjectPurchase && (
             <div className="px-5 py-4 bg-[#0a0907]/40 border-t border-white/[0.04] space-y-1">
               <div className="flex justify-between items-center text-[10px] font-mono text-[#5a5142] uppercase tracking-wider">
                 <span>Subtotal</span>
                 <span>${cartTotal()}</span>
               </div>
               <div className="flex justify-between items-center text-[10px] font-mono text-[#5a5142] uppercase tracking-wider">
                 <span>Processing Fee</span>
                 <span>$0.00</span>
               </div>
               <div className="flex justify-between items-center pt-2 mt-1 border-t border-white/[0.02]">
                 <span className="text-[10px] font-mono text-[#a08a6a] uppercase tracking-wider">Total amount</span>
                 <span className="text-[18px] font-bold text-white tabular-nums">${cartTotal()}</span>
               </div>
             </div>
           )}

        </div>

        {/* Trust & Reassurance Badges */}
        <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] p-5 space-y-4">
          <h4 className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142]">Purchase Guarantees</h4>
          
          <div className="space-y-3.5">
            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <Check size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#E8DCC8]">Instant Digital Delivery</p>
                <p className="text-[9px] text-[#6a5d4a] leading-relaxed mt-0.5">Receive high-quality audio files (MP3/WAV) immediately after payment.</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <FileText size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#E8DCC8]">Legal License Agreement</p>
                <p className="text-[9px] text-[#6a5d4a] leading-relaxed mt-0.5">Get a PDF contract detailing streaming/distribution rights for your projects.</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <ShieldCheck size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#E8DCC8]">Secure SSL Payment</p>
                <p className="text-[9px] text-[#6a5d4a] leading-relaxed mt-0.5">Transactions processed safely by Stripe. Card numbers are never stored.</p>
              </div>
            </div>

            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-lg bg-[#0e1f17] border border-[#6DC6A4]/15 flex items-center justify-center text-[#6DC6A4] shrink-0">
                <Lock size={11} />
              </div>
              <div>
                <p className="text-[11px] font-bold text-[#E8DCC8]">One-Time Payment</p>
                <p className="text-[9px] text-[#6a5d4a] leading-relaxed mt-0.5">No recurring fees or monthly subscriptions. Pay once and keep forever.</p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/[0.04] text-center">
            <p className="text-[10px] text-[#5a5142] font-mono leading-relaxed">
              Need assistance? Email us at <br/>
              <span className="text-[#a08a6a]">support@antigravity.fm</span>
            </p>
          </div>
        </div>

      </div>

    </div>
  );
}

export default function CheckoutPage() {
  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] pt-4 pb-20">
      <Suspense fallback={
        <div className="min-h-[70vh] flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-[#5a5142]" />
        </div>
      }>
        <CheckoutContent />
      </Suspense>
    </div>
  );
}
