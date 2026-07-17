'use client';

import dynamic from 'next/dynamic';

const IdeogramStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/ideogram/ideogram-studio').then((m) => m.IdeogramStudio),
  { ssr: false }
);

export default function IdeogramPage() {
  return <IdeogramStudio />;
}
