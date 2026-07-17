'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { reelfarmDescriptor } from './descriptor';

export function ReelFarmStudio() {
  return <StudioShell descriptor={reelfarmDescriptor} />;
}
