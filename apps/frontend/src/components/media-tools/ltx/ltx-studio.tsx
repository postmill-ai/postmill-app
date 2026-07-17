'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { ltxDescriptor } from './descriptor';

export function LtxStudio() {
  return <StudioShell descriptor={ltxDescriptor} />;
}
