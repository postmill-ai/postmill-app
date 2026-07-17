'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { googleAiDescriptor } from './descriptor';

export function GoogleAiStudio() {
  return <StudioShell descriptor={googleAiDescriptor} />;
}
