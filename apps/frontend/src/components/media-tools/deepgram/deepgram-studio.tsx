'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { deepgramDescriptor } from './descriptor';

export function DeepgramStudio() {
  return <StudioShell descriptor={deepgramDescriptor} />;
}
