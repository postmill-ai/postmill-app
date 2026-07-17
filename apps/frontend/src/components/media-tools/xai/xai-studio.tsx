'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { xaiDescriptor } from './descriptor';

export function XaiStudio() {
  return <StudioShell descriptor={xaiDescriptor} />;
}
