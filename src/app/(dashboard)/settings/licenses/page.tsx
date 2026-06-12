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
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { LicenseBuilder } from '@/components/store/LicenseBuilder';

export default function LicensesSettingsPage() {
  const router = useRouter();
  return (
    <DashboardLayout>
      <PageContainer className="max-w-[780px] pb-32">
        <PageHeader
          eyebrow="Settings / Store"
          title="License Builder"
          description="Define the tiers buyers see across checkout, shares, and the storefront."
          actions={
          <button
            onClick={() => router.push('/settings')}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-[#2B2821] bg-[#171511] px-3 text-[11px] font-medium text-[#D0C3AF] transition-colors hover:border-[#3B372F] hover:text-[#F7EBDD]"
          >
            <ArrowLeft size={14} />
            Settings
          </button>
          }
        />

        {/* Redirect notice */}
        <div className="rounded-xl border border-[#E7D7BE]/20 bg-[#E7D7BE]/5 p-4 mb-6 flex items-start gap-3">
          <ExternalLink size={13} className="text-[#E7D7BE] shrink-0 mt-0.5" />
          <div className="text-[11px] text-[#D0C3AF] leading-relaxed">
            <p className="font-medium text-[#E7D7BE] mb-1">This section has moved</p>
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
      </PageContainer>
    </DashboardLayout>
  );
}
