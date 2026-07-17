'use client';

import dynamic from 'next/dynamic';

const GroqStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/groq/groq-studio').then((m) => m.GroqStudio),
  { ssr: false }
);

export default function GroqPage() {
  return <GroqStudio />;
}
