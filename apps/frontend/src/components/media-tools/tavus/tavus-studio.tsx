'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { tavusDescriptor } from './descriptor';

export function TavusStudio() {
  return <StudioShell descriptor={tavusDescriptor} />;
}
