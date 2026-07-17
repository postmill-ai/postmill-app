'use client';

import dynamic from 'next/dynamic';

const GoogleAiStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/google-ai/google-ai-studio').then((m) => m.GoogleAiStudio),
  { ssr: false }
);

export default function GoogleAiPage() {
  return <GoogleAiStudio />;
}
