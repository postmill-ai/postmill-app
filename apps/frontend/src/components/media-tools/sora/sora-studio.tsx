'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { soraDescriptor } from './descriptor';

export function SoraStudio() {
  return <StudioShell descriptor={soraDescriptor} />;
}
