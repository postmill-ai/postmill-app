'use client';

import React from 'react';
import { StudioShell } from '@postmill-ai/frontend/components/media-tools/studio-kit/studio-shell';
import { minimaxDescriptor } from './descriptor';

export function MinimaxStudio() {
  return <StudioShell descriptor={minimaxDescriptor} />;
}
