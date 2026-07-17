'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { runwayDescriptor } from './descriptor';

export function RunwayStudio() {
  return <StudioShell descriptor={runwayDescriptor} />;
}
