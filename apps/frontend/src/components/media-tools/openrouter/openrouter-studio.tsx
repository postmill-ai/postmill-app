'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { openrouterDescriptor } from './descriptor';

export function OpenRouterStudio() {
  return <StudioShell descriptor={openrouterDescriptor} />;
}
