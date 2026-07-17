'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useBrands } from '@gitroom/frontend/components/settings/brand/use-brands';
import { CampaignSelector } from '@gitroom/frontend/components/campaigns/selector/campaign-selector';
import { SettingsGate } from '@gitroom/frontend/components/settings/settings-gate';

// Brand-edit chrome (former BrandTab `subtab === 'edit'` view): back link, name, intro,
// campaign selector, and the Voice/Kit/Knowledge sub-nav — now real routes.
function BrandEditLayoutInner({ children }: { children: React.ReactNode }) {
  const t = useT();
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const id = String(params.id);
  const { data: brands, isLoading } = useBrands();
  const brand = brands?.find((b) => b.id === id);

  // Unknown/deleted brand id (e.g. a hand-edited or stale URL) → back to the list rather
  // than leaving the user on empty edit chrome.
  useEffect(() => {
    if (!isLoading && brands && !brand) router.replace('/settings/ai/brands');
  }, [isLoading, brands, brand, router]);

  const editTabs = [
    {
      href: `/settings/ai/brands/${id}/voice`,
      label: t('tab_voice', 'Voice & Tone'),
      hint: t('tab_voice_hint', 'How the AI writes for you'),
    },
    {
      href: `/settings/ai/brands/${id}/kit`,
      label: t('tab_kit', 'Brand Kit'),
      hint: t('tab_kit_hint', 'Your logo & colours'),
    },
    {
      href: `/settings/ai/brands/${id}/knowledge`,
      label: t('tab_knowledge', 'Knowledge'),
      hint: t('tab_knowledge_hint', 'What the AI knows about you'),
    },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-[12px] mb-[8px]">
        <Link
          href="/settings/ai/brands"
          className="text-[13px] text-newTableText hover:text-textColor"
        >
          ← {t('back_to_brands', 'Back to Brands')}
        </Link>
        <h3 className="text-[20px]">{brand?.name ?? t('brand', 'Brand')}</h3>
      </div>
      <p className="text-[13px] text-newTableText mb-[16px] max-w-[640px] leading-relaxed">
        {t(
          'brand_editor_intro',
          "A “brand” is a personality for the AI. Set up how it should write, what your brand looks like, and what it knows about your business — then it'll create on-brand posts for you. Pick a section below to get started."
        )}
      </p>

      <div className="mb-[16px] max-w-[640px]">
        <CampaignSelector entityType="brand" entityId={id} />
      </div>

      <div className="flex gap-[8px] flex-wrap mb-[16px]">
        {editTabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-start text-start px-[16px] py-[10px] rounded-[10px] border transition-colors ${
                active
                  ? 'border-btnPrimary bg-btnPrimary/10'
                  : 'border-newTableBorder hover:bg-boxHover'
              }`}
            >
              <span className="text-[14px] text-textColor">{tab.label}</span>
              <span className="text-[11px] text-newTableText">{tab.hint}</span>
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}

// Brands are a paid-tier feature (parity with the old AITab sub-tab gate).
export default function BrandEditLayout({ children }: { children: React.ReactNode }) {
  const user = useUser();
  return (
    <SettingsGate allow={user ? !!user.tier?.brand_kits : undefined}>
      <BrandEditLayoutInner>{children}</BrandEditLayoutInner>
    </SettingsGate>
  );
}
