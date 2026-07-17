'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { pikaDescriptor } from './descriptor';

export function PikaStudio() {
  return <StudioShell descriptor={pikaDescriptor} />;
}
