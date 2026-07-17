'use client';

import dynamic from 'next/dynamic';

const GatewayStudio = dynamic(
  () => import('@gitroom/frontend/components/media-tools/gateway/gateway-studio').then((m) => m.GatewayStudio),
  { ssr: false }
);

export default function GatewayPage() {
  return <GatewayStudio />;
}
