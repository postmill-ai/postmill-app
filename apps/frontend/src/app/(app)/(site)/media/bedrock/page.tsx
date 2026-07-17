'use client';

import dynamic from 'next/dynamic';

const BedrockStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/bedrock/bedrock-studio').then((m) => m.BedrockStudio),
  { ssr: false }
);

export default function BedrockPage() {
  return <BedrockStudio />;
}
