'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { ideogramDescriptor } from './descriptor';

export function IdeogramStudio() {
  return <StudioShell descriptor={ideogramDescriptor} />;
}
