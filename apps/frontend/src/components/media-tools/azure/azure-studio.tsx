'use client';

import React from 'react';
import { StudioShell } from '@postmill-ai/frontend/components/media-tools/studio-kit/studio-shell';
import { azureDescriptor } from './descriptor';

export function AzureStudio() {
  return <StudioShell descriptor={azureDescriptor} />;
}
