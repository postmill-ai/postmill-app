'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { elevenlabsDescriptor } from './descriptor';

export function ElevenLabsStudio() {
  return <StudioShell descriptor={elevenlabsDescriptor} />;
}
