'use client';

import dynamic from 'next/dynamic';

const LumaStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/luma/luma-studio').then((m) => m.LumaStudio),
  { ssr: false }
);

export default function LumaPage() {
  return <LumaStudio />;
}
