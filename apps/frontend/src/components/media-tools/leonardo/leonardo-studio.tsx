'use client';

import React from 'react';
import { StudioShell } from '@postmill-ai/frontend/components/media-tools/studio-kit/studio-shell';
import { leonardoDescriptor } from './descriptor';

export function LeonardoStudio() {
  return <StudioShell descriptor={leonardoDescriptor} />;
}
