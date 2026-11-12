'use client';

import { useParams } from 'next/navigation';
import { KnowledgeBase } from '@postmill-ai/frontend/components/settings/brand/knowledge-base';

export default function Page() {
  const params = useParams();
  return <KnowledgeBase brandId={String(params.id)} />;
}
