import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : fallback,
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

vi.mock('@postmill-ai/frontend/components/layout/use-media-tools-status', () => ({
  useMediaToolsStatus: () => ({
    status: undefined,
    isLoading: false,
    operationAvailable: () => true,
    toolAvailable: () => true,
    tool: () => undefined,
  }),
}));

vi.mock('@postmill-ai/frontend/components/media-tools/use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), element: null }),
}));

const fetchMock = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

import { AiPanel } from './ai-panel';

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

const store = {
  getState: () => ({
    doc: { outputs: [{ width: 100, height: 100 }] },
    currentOutput: 0,
    addElement: vi.fn(),
  }),
};

const renderPanel = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AiPanel store={store} />
    </SWRConfig>
  );

const typePrompt = async (text: string) => {
  const input = await screen.findByPlaceholderText('Describe the image...');
  fireEvent.change(input, { target: { value: text } });
};

const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(path));

beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/media/generation-providers')) {
      return Promise.resolve(
        ok({
          providers: [{ identifier: 'google', name: 'Google AI Studio' }],
          default: { providerId: 'google-ai', model: 'imagen-3' },
        })
      );
    }
    if (url.includes('/media/studio/google/status')) {
      return Promise.resolve(ok({ configured: true, enabled: true }));
    }
    if (url.includes('/media/studio/google/jobs')) return Promise.resolve(ok([]));
    if (url.includes('/media/generate-image-with-prompt')) {
      return Promise.resolve(ok({ id: 'f1', path: '/uploads/x.png', name: 'x' }));
    }
    if (url.includes('/generate')) return Promise.resolve(ok({ jobId: 'job-1' }));
    return Promise.resolve(ok({}));
  });
});

afterEach(cleanup);

describe('AiPanel provider picker wiring', () => {
  it('posts the unchanged legacy payload on the Default path', async () => {
    renderPanel();
    await typePrompt('a cat');
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(callsTo('/media/generate-image-with-prompt')).toHaveLength(1));
    const [, init] = callsTo('/media/generate-image-with-prompt')[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ prompt: 'a cat' });
    expect(callsTo('/media/studio/google/generate')).toHaveLength(0);
  });

  it('hides the legacy Generate and routes generation through the compact studio when a provider is picked', async () => {
    renderPanel();
    await typePrompt('a cat');
    const select = (await screen.findByLabelText('Provider:')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'google' } });

    // Exactly one Generate button remains — the compact studio's, not the legacy one.
    const generate = await screen.findByRole('button', { name: 'Generate' });
    expect(screen.getAllByRole('button', { name: 'Generate' })).toHaveLength(1);
    fireEvent.click(generate);

    await waitFor(() => expect(callsTo('/media/studio/google/generate')).toHaveLength(1));
    expect(callsTo('/media/generate-image-with-prompt')).toHaveLength(0);
    const [, init] = callsTo('/media/studio/google/generate')[0];
    expect(JSON.parse((init as RequestInit).body as string).input.prompt).toBe('a cat');
  });
});
