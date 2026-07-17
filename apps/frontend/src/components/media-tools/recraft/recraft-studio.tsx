'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { recraftDescriptor } from './descriptor';

export function RecraftStudio() {
  return <StudioShell descriptor={recraftDescriptor} />;
}
