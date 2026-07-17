'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { deepinfraDescriptor } from './descriptor';

export function DeepInfraStudio() {
  return <StudioShell descriptor={deepinfraDescriptor} />;
}
