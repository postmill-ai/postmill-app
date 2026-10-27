import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string) =>
      fallback,
}));

import { GenerateButton } from './replicate-studio';
import { useReplicateStore } from './replicate.store';

const MODEL = {
  id: 'bytedance/seedance-1-pro',
  name: 'Seedance 1 Pro',
  coverImageUrl: null,
  warm: true,
  versionId: 'v1',
  inputSchema: { required: ['prompt', 'image', 'duration'] },
};

const renderGenerateButton = (saveFolderId: string | null | undefined) => {
  useReplicateStore.setState({
    selectedModel: MODEL,
    formInput: {
      prompt: 'A rocket launching',
      image: { fileId: 'image-1', url: '/uploads/rocket.png' },
      duration: 5,
    },
    runState: 'idle',
    saveFolderId,
  });
  return render(<GenerateButton category="image-to-video" />);
};

describe('GenerateButton save destination', () => {
  beforeEach(() => {
    useReplicateStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useReplicateStore.getState().reset();
  });

  it('allows generating into the Files root', () => {
    renderGenerateButton(null);

    expect(screen.getByRole('button', { name: 'Generate' })).toHaveProperty('disabled', false);
    expect(screen.queryByText('Pick a save folder before generating.')).toBeNull();
  });

  it('blocks generating when no save destination is selected', () => {
    renderGenerateButton(undefined);

    expect(screen.getByRole('button', { name: 'Generate' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Pick a save folder before generating.')).toBeDefined();
  });

  it('allows generating into an actual folder', () => {
    renderGenerateButton('folder-1');

    expect(screen.getByRole('button', { name: 'Generate' })).toHaveProperty('disabled', false);
    expect(screen.queryByText('Pick a save folder before generating.')).toBeNull();
  });
});
