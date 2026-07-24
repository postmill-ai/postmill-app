'use client';

import React from 'react';
import { StudioShell } from '@postmill-ai/frontend/components/media-tools/studio-kit/studio-shell';
import { wanDescriptor } from './descriptor';

export function WanStudio() {
  return <StudioShell descriptor={wanDescriptor} />;
}
