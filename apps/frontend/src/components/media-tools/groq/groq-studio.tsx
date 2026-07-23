'use client';

import React from 'react';
import { StudioShell } from '@postmill-ai/frontend/components/media-tools/studio-kit/studio-shell';
import { groqDescriptor } from './descriptor';

export function GroqStudio() {
  return <StudioShell descriptor={groqDescriptor} />;
}
