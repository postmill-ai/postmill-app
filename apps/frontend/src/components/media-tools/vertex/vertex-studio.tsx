'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { vertexDescriptor } from './descriptor';

export function VertexStudio() {
  return <StudioShell descriptor={vertexDescriptor} />;
}
