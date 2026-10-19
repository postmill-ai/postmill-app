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

const fetchMock = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

import { VoiceoverDialog } from './voiceover-dialog';

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

const wrap = (ui: React.ReactElement) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
  );

const voicesFor = (url: string) => {
  if (url.includes('provider=openai')) return [{ id: 'v-openai', label: 'OpenAI Voice' }];
  return [{ id: 'v-default', label: 'Default Voice' }];
};

beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/media/generation-providers')) {
      return Promise.resolve(
        ok({
          providers: [
            { identifier: 'openai', name: 'OpenAI' },
            // NOT in the compact registry — TTS has no studios, so the
            // dropdown must list it anyway (requireCompact={false}).
            { identifier: 'acme-tts', name: 'Acme TTS' },
          ],
          default: { providerId: 'elevenlabs', model: 'eleven_v3' },
        })
      );
    }
    if (url.includes('/media/voices')) return Promise.resolve(ok(voicesFor(url)));
    return Promise.resolve(ok({}));
  });
});

afterEach(cleanup);

describe('VoiceoverDialog provider picker', () => {
  it('lists every TTS provider (not registry-filtered) with the exact Default label', async () => {
    wrap(<VoiceoverDialog onClose={vi.fn()} onGenerate={vi.fn()} />);
    expect(await screen.findByText('Default (elevenlabs/eleven_v3)')).toBeTruthy();
    expect(await screen.findByText('Acme TTS')).toBeTruthy();
    expect(await screen.findByText('OpenAI')).toBeTruthy();
  });

  it('refetches voices for the picked provider and resets the selected voice', async () => {
    wrap(<VoiceoverDialog onClose={vi.fn()} onGenerate={vi.fn()} />);
    const voiceSelect = (await screen.findByLabelText(/Voice/)) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByText('Default Voice')).toBeTruthy());
    fireEvent.change(voiceSelect, { target: { value: 'v-default' } });
    expect(voiceSelect.value).toBe('v-default');

    const providerSelect = (await screen.findByLabelText('Provider:')) as HTMLSelectElement;
    fireEvent.change(providerSelect, { target: { value: 'openai' } });

    // Voice ids are provider-specific — the pick resets and the list refetches.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('/media/voices?provider=openai'))
      ).toBe(true)
    );
    await waitFor(() => expect(screen.getByText('OpenAI Voice')).toBeTruthy());
    expect((screen.getByLabelText(/Voice/) as HTMLSelectElement).value).toBe('');
  });

  it('passes no provider on the Default path', async () => {
    const onGenerate = vi.fn();
    wrap(<VoiceoverDialog onClose={vi.fn()} onGenerate={onGenerate} />);
    fireEvent.change(await screen.findByPlaceholderText('Type the voiceover text…'), {
      target: { value: 'hello world' },
    });
    const voiceSelect = (await screen.findByLabelText(/Voice/)) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByText('Default Voice')).toBeTruthy());
    fireEvent.change(voiceSelect, { target: { value: 'v-default' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith('hello world', 'v-default', undefined, undefined));
  });

  it('threads the pinned provider through onGenerate', async () => {
    const onGenerate = vi.fn();
    wrap(<VoiceoverDialog onClose={vi.fn()} onGenerate={onGenerate} />);
    fireEvent.change(await screen.findByPlaceholderText('Type the voiceover text…'), {
      target: { value: 'hello world' },
    });
    const providerSelect = (await screen.findByLabelText('Provider:')) as HTMLSelectElement;
    fireEvent.change(providerSelect, { target: { value: 'openai' } });
    const voiceSelect = (await screen.findByLabelText(/Voice/)) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByText('OpenAI Voice')).toBeTruthy());
    fireEvent.change(voiceSelect, { target: { value: 'v-openai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() =>
      expect(onGenerate).toHaveBeenCalledWith('hello world', 'v-openai', undefined, 'openai')
    );
  });
});
