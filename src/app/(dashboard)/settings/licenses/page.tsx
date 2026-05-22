'use client';

/**
 * /settings/licenses — kept for backward-compat links.
 * The canonical location for the license builder is now /store-editor.
 * This page still renders the full LicenseBuilder component so direct
 * nav links continue to work, but it shows a banner pointing to the
 * store editor.
 */

import { useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { LicenseBuilder } from '@/components/store/LicenseBuilder';

export default function LicensesSettingsPage() {
  const router = useRouter();
  return (
    <DashboardLayout>
      <div className="max-w-[780px] mx-auto px-4 sm:px-6 md:px-10 pt-6 md:pt-10 pb-32">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => router.push('/settings')}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#6a5d4a] hover:text-white hover:bg-white/[0.04] transition-colors"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-[#5a5142]">
              Settings / Store
            </p>
            <h1 className="text-[22px] font-bold text-white tracking-tight">License Builder</h1>
          </div>
        </div>

        {/* Redirect notice */}
        <div className="rounded-xl border border-[#D4BFA0]/20 bg-[#D4BFA0]/5 p-4 mb-6 flex items-start gap-3">
          <ExternalLink size={13} className="text-[#D4BFA0] shrink-0 mt-0.5" />
          <div className="text-[11px] text-[#a08a6a] leading-relaxed">
            <p className="font-medium text-[#D4BFA0] mb-1">This section has moved</p>
            <p>
              License tiers are now managed in the{' '}
              <button
                onClick={() => router.push('/store-editor')}
                className="underline underline-offset-2 hover:text-white transition-colors"
              >
                Store Editor →
              </button>{' '}
              (License Tiers section). Changes made here are reflected there and vice versa.
            </p>
          </div>
        </div>

        <LicenseBuilder />
      </div>
    </DashboardLayout>
  );
}
