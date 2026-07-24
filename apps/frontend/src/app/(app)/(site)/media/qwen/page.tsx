'use client';

import dynamic from 'next/dynamic';

const QwenStudio = dynamic(
  () => import('@postmill-ai/frontend/components/media-tools/qwen/qwen-studio').then((m) => m.QwenStudio),
  { ssr: false }
);

export default function QwenPage() {
  return <QwenStudio />;
}
