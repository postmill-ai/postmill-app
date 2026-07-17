'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { siliconflowDescriptor } from './descriptor';

export function SiliconFlowStudio() {
  return <StudioShell descriptor={siliconflowDescriptor} />;
}
