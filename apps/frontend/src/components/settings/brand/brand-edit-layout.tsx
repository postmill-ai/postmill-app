'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { useBrands } from '@postmill-ai/frontend/components/settings/brand/use-brands';
import { CampaignSelector } from '@postmill-ai/frontend/components/campaigns/selector/campaign-selector';
import { SettingsGate } from '@postmill-ai/frontend/components/settings/settings-gate';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';

function BrandEditLayoutInner({ children }: { children: React.ReactNode }) {
  const t = useT();
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const id = String(params.id);
  const { data: brands, isLoading } = useBrands();
  const brand = brands?.find((b) => b.id === id);

  useEffect(() => {
    if (!isLoading && brands && !brand) router.replace('/brands');
  }, [isLoading, brands, brand, router]);

  const editTabs = [
    {
      key: 'voice',
      href: `/brands/${id}/voice`,
      label: t('tab_voice', 'Voice & Tone'),
      hint: t('tab_voice_hint', 'How the AI writes for you'),
    },
    {
      key: 'kit',
      href: `/brands/${id}/kit`,
      label: t('tab_kit', 'Brand Kit'),
      hint: t('tab_kit_hint', 'Your visuals, formats, and templates'),
    },
    {
      key: 'knowledge',
      href: `/brands/${id}/knowledge`,
      label: t('tab_knowledge', 'Knowledge'),
      hint: t('tab_knowledge_hint', 'What the AI knows about this brand'),
    },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-[12px] mb-[8px]">
        <Link href="/brands" className="text-[13px] text-newTableText hover:text-textColor">
          ← {t('back_to_brand_studio', 'Back to Brand Studio')}
        </Link>
        <h3 className="text-[20px]">{brand?.name ?? t('brand', 'Brand')}</h3>
      </div>
      <p className="text-[13px] text-newTableText mb-[16px] max-w-[640px] leading-relaxed">
        {t(
          'brand_studio_editor_intro',
          'This Brand Kit is the source of truth for this brand. Its voice, visuals, formats, templates, and knowledge are used across Designer, AI Designer, and AI copy.'
        )}
      </p>

      <div className="mb-[16px] max-w-[640px]">
        <CampaignSelector entityType="brand" entityId={id} />
      </div>

      <div className="mb-[16px]">
        <OverflowTabs
          items={editTabs.map((tab) => ({ key: tab.key, label: tab.label }))}
          activeKey={editTabs.find((tab) => pathname.startsWith(tab.href))?.key || 'voice'}
          onSelect={(key) => {
            const tab = editTabs.find((candidate) => candidate.key === key);
            if (tab) router.push(tab.href);
          }}
          variant="outline"
          semantics="nav"
          ariaLabel={t('brand_sections', 'Brand sections')}
        />
      </div>

      {children}
    </div>
  );
}

export const BrandEditLayout = ({ children }: { children: React.ReactNode }) => {
  const user = useUser();
  return (
    <SettingsGate allow={user ? !!user.tier?.brand_kits : undefined}>
      <BrandEditLayoutInner>{children}</BrandEditLayoutInner>
    </SettingsGate>
  );
};
