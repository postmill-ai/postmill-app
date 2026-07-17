'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { fireworksDescriptor } from './descriptor';

export function FireworksStudio() {
  return <StudioShell descriptor={fireworksDescriptor} />;
}
