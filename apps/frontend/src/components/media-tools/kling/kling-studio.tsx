'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { klingDescriptor } from './descriptor';

export function KlingStudio() {
  return <StudioShell descriptor={klingDescriptor} />;
}
