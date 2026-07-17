'use client';

import dynamic from 'next/dynamic';

const SiliconFlowStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/siliconflow/siliconflow-studio').then((m) => m.SiliconFlowStudio),
  { ssr: false }
);

export default function SiliconFlowPage() {
  return <SiliconFlowStudio />;
}
