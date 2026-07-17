'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { higgsfieldDescriptor } from './descriptor';

export function HiggsfieldStudio() {
  return <StudioShell descriptor={higgsfieldDescriptor} />;
}
