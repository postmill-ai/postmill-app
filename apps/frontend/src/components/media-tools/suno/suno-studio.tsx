'use client';

import React from 'react';
import { StudioShell } from '@postmill-ai/frontend/components/media-tools/studio-kit/studio-shell';
import { sunoDescriptor } from './descriptor';

export function SunoStudio() {
  return <StudioShell descriptor={sunoDescriptor} />;
}
