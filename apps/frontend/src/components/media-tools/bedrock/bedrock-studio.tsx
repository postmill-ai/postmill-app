'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { bedrockDescriptor } from './descriptor';

export function BedrockStudio() {
  return <StudioShell descriptor={bedrockDescriptor} />;
}
