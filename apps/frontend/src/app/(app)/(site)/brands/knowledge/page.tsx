'use client';

import Link from 'next/link';
import { KnowledgeBase } from '@postmill-ai/frontend/components/settings/brand/knowledge-base';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export default function Page() {
  const t = useT();
  return (
    <div className="p-[20px] mobile:p-[16px]">
      <Link href="/brands" className="text-[13px] text-newTableText hover:text-textColor">
        ← {t('back_to_brand_studio', 'Back to Brand Studio')}
      </Link>
      <KnowledgeBase legacy />
    </div>
  );
}
