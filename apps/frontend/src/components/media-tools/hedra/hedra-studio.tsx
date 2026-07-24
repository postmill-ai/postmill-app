'use client';

import React from 'react';
import { StudioShell } from '@postmill-ai/frontend/components/media-tools/studio-kit/studio-shell';
import { hedraDescriptor } from './descriptor';

export function HedraStudio() {
  return <StudioShell descriptor={hedraDescriptor} />;
}
