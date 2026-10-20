import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from 'vitest';
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

vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn(), closeAll: vi.fn(), closeById: vi.fn(), closeCurrent: vi.fn() }),
  usePromptModal: () => ({ open: vi.fn() }),
  useHasOpenModals: () => false,
}));

vi.mock('@postmill-ai/frontend/components/media-tools/use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), element: null }),
}));

const fetchMock = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

// video-timeline builds a module-scope AudioContext singleton, which jsdom
// lacks — stub it before the module is imported.
class MockAudioContext {
  createGain() {
    return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
  }
  createBufferSource() {
    return { connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
  createMediaElementSource() {
    return { connect: vi.fn() };
  }
  get destination() {
    return {};
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

let SlideshowDialog: (typeof import('./video-timeline'))['SlideshowDialog'];

beforeAll(async () => {
  vi.stubGlobal('AudioContext', MockAudioContext);
  ({ SlideshowDialog } = await import('./video-timeline'));
});

const toaster = { show: vi.fn() };

const wrap = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

beforeEach(() => {
  fetchMock.mockReset();
  toaster.show.mockReset();
});

afterEach(cleanup);

describe('SlideshowDialog error surfacing', () => {
  it('toasts the server error message when generate-slide 409s', async () => {
    // Prod regression: the dialog closed on a 409 { error, category } without
    // surfacing the reason — the user only saw "Slideshow failed to generate".
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'Text-to-speech is not available. Configure a TTS-capable media provider (ElevenLabs or OpenAI) in Settings > Media.',
        category: 'speech',
      }),
    } as Response);

    wrap(<SlideshowDialog fetch={fetchMock as never} toaster={toaster as never} onResult={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText('Describe the slideshow...'), {
      target: { value: 'fresh farm vegetables slideshow, rustic style' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(toaster.show).toHaveBeenCalledWith(
        'Text-to-speech is not available. Configure a TTS-capable media provider (ElevenLabs or OpenAI) in Settings > Media.',
        'warning',
      ),
    );
  });

  it('falls back to the generic message when the 409 body carries none', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({}),
    } as Response);

    wrap(<SlideshowDialog fetch={fetchMock as never} toaster={toaster as never} onResult={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText('Describe the slideshow...'), {
      target: { value: 'a slideshow' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(toaster.show).toHaveBeenCalledWith('Slideshow generation failed', 'warning'),
    );
  });

  it('hands the job id to onResult on success', async () => {
    const onResult = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'slide-job-1', status: 'pending' }),
    } as Response);

    wrap(<SlideshowDialog fetch={fetchMock as never} toaster={toaster as never} onResult={onResult} />);
    fireEvent.change(await screen.findByPlaceholderText('Describe the slideshow...'), {
      target: { value: 'a slideshow' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith('video', 'slide-job-1'));
    expect(toaster.show).not.toHaveBeenCalled();
  });
});
