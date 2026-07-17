'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { lumaDescriptor } from './descriptor';

export function LumaStudio() {
  return <StudioShell descriptor={lumaDescriptor} />;
}
