'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { didDescriptor } from './descriptor';

export function DIDStudio() {
  return <StudioShell descriptor={didDescriptor} />;
}
