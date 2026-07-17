'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { stabilityDescriptor } from './descriptor';

export function StabilityStudio() {
  return <StudioShell descriptor={stabilityDescriptor} />;
}
