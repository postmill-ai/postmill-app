'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { blackForestLabsDescriptor } from './descriptor';

export function BlackForestLabsStudio() {
  return <StudioShell descriptor={blackForestLabsDescriptor} />;
}
