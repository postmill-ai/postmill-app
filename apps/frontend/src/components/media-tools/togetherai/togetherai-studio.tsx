'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { togetheraiDescriptor } from './descriptor';

export function TogetherAiStudio() {
  return <StudioShell descriptor={togetheraiDescriptor} />;
}
