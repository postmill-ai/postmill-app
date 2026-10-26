'use client';

import React from 'react';
import { StudioShell } from '@postmill-ai/frontend/components/media-tools/studio-kit/studio-shell';
import { falDescriptor } from './descriptor';

export function FalStudio() {
  return <StudioShell descriptor={falDescriptor} />;
}
