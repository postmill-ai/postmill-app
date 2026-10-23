import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string) =>
      fallback,
}));

const fetchMock = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

import { ModelPicker } from './model-picker';
import { useReplicateStore } from './replicate.store';

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

const MODELS = [
  {
    id: 'minimax/video-01',
    name: 'video-01',
    description: '',
    coverImageUrl: null,
    runCount: 10,
    warm: true,
    pricing: 'output',
    price: { kind: 'per-video', usd: 0.5 },
    notes: ['No audio track', 'Text in video may contain spelling errors'],
  },
  {
    id: 'google/veo-3.1',
    name: 'veo-3.1',
    description: '',
    coverImageUrl: null,
    runCount: 20,
    warm: true,
    pricing: 'output',
    price: { kind: 'per-video', usd: 1 },
  },
];

const renderPicker = () =>
  render(
    // Fresh cache per render so the SWR key never serves a previous test.
    <SWRConfig value={{ provider: () => new Map() }}>
      <ModelPicker categoryKey="text-to-video" />
    </SWRConfig>,
  );

describe('ModelPicker capability notes', () => {
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
    useReplicateStore.getState().setSelectedModel(null);
  });

  it('renders the curated notes for the selected model under the picker', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/categories/')) return ok(MODELS);
      return ok({ id: 'minimax/video-01', name: 'video-01', inputSchema: null });
    });

    renderPicker();

    const select = await screen.findByLabelText('Model');
    fireEvent.change(select, { target: { value: 'minimax/video-01' } });

    expect(await screen.findByText('No audio track')).toBeDefined();
    expect(
      screen.getByText('Text in video may contain spelling errors'),
    ).toBeDefined();
  });

  it('renders no notes block for a model without curated notes', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/categories/')) return ok(MODELS);
      return ok({ id: 'google/veo-3.1', name: 'veo-3.1', inputSchema: null });
    });

    renderPicker();

    const select = await screen.findByLabelText('Model');
    fireEvent.change(select, { target: { value: 'google/veo-3.1' } });

    await waitFor(() => {
      expect(useReplicateStore.getState().selectedModel?.id).toBe('google/veo-3.1');
    });
    expect(screen.queryByText('No audio track')).toBeNull();
    expect(document.querySelector('ul')).toBeNull();
  });
});
