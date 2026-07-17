'use client';

import React from 'react';
import { StudioShell } from '@gitroom/frontend/components/media-tools/studio-kit/studio-shell';
import { genviralDescriptor } from './descriptor';

export function GenviralStudio() {
  return <StudioShell descriptor={genviralDescriptor} />;
}
