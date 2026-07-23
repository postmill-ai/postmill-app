'use client';

import React from 'react';
import { StudioShell } from '@postmill-ai/frontend/components/media-tools/studio-kit/studio-shell';
import { qwenDescriptor } from './descriptor';

export function QwenStudio() {
  return <StudioShell descriptor={qwenDescriptor} />;
}
