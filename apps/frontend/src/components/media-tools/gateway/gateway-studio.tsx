'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { gatewayDescriptor } from './descriptor';

export function GatewayStudio() {
  return <StudioShell descriptor={gatewayDescriptor} />;
}
