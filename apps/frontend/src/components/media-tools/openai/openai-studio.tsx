'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { openaiDescriptor } from './descriptor';

export function OpenaiStudio() {
  return <StudioShell descriptor={openaiDescriptor} />;
}
