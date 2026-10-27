import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeAll } from 'vitest';

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
    return { connect: vi.fn(), disconnect: vi.fn() };
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

let AiVideoDialog: (typeof import('./video-timeline'))['AiVideoDialog'];
let MusicDialog: (typeof import('./video-timeline'))['MusicDialog'];

beforeAll(async () => {
  vi.stubGlobal('AudioContext', MockAudioContext);
  ({ AiVideoDialog, MusicDialog } = await import('./video-timeline'));
});

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

const toaster = { show: vi.fn() } as never;

const wrap = (ui: React.ReactElement) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
  );

const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(path));

beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/media/generation-providers')) {
      const audio = url.includes('operation=audio');
      const tts = url.includes('operation=tts');
      return Promise.resolve(
        ok({
          providers: audio
            ? [{ identifier: 'suno', name: 'Suno' }]
            : tts
              ? [{ identifier: 'heygen', name: 'HeyGen' }]
              : [{ identifier: 'google', name: 'Google AI Studio' }],
          default: { providerId: 'fal', model: 'kling-2.1' },
        })
      );
    }
    if (url.includes('/media/voices')) {
      return Promise.resolve(ok([{ id: 'voice-1', label: 'Ava' }]));
    }
    if (url.includes('/media/studio/suno/status')) {
      return Promise.resolve(ok({ configured: true, enabled: true }));
    }
    if (url.includes('/media/studio/suno/jobs')) return Promise.resolve(ok([]));
    if (url.includes('/media/studio/google/status')) {
      return Promise.resolve(ok({ configured: true, enabled: true }));
    }
    if (url.includes('/media/studio/google/jobs')) return Promise.resolve(ok([]));
    if (url.includes('/media/studio/suno/models')) return Promise.resolve(ok([]));
    if (url.includes('/media/generate-video')) return Promise.resolve(ok({ id: 'legacy-video-job' }));
    if (url.includes('/media/generate-music')) return Promise.resolve(ok({ id: 'legacy-music-job' }));
    if (url.includes('/generate')) return Promise.resolve(ok({ jobId: 'job-1' }));
    return Promise.resolve(ok({}));
  });
});

afterEach(cleanup);

describe('AiVideoDialog provider picker wiring', () => {
  it('posts the unchanged legacy payload on the Default path', async () => {
    const onResult = vi.fn();
    wrap(<AiVideoDialog fetch={fetchMock as never} toaster={toaster} onResult={onResult} />);
    fireEvent.change(await screen.findByPlaceholderText('Describe the video you want to generate...'), {
      target: { value: 'a rocket launch' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(callsTo('/media/generate-video')).toHaveLength(1));
    const [, init] = callsTo('/media/generate-video')[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ prompt: 'a rocket launch' });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('video', 'legacy-video-job'));
    expect(callsTo('/media/studio/google/generate')).toHaveLength(0);
  });

  it('hides the legacy Generate and routes generation through the compact studio when a provider is picked', async () => {
    wrap(<AiVideoDialog fetch={fetchMock as never} toaster={toaster} onResult={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText('Describe the video you want to generate...'), {
      target: { value: 'a rocket launch' },
    });
    const select = (await screen.findByLabelText('Provider:')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'google' } });

    const generate = await screen.findByRole('button', { name: 'Generate' });
    expect(screen.getAllByRole('button', { name: 'Generate' })).toHaveLength(1);
    fireEvent.click(generate);

    await waitFor(() => expect(callsTo('/media/studio/google/generate')).toHaveLength(1));
    expect(callsTo('/media/generate-video')).toHaveLength(0);
    const [, init] = callsTo('/media/studio/google/generate')[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.operation).toBe('video');
    expect(body.input.prompt).toBe('a rocket launch');
  });

  it('adds the selected narration only after the visual lands successfully', async () => {
    const onResult = vi.fn().mockResolvedValue(true);
    const onGenerateVoiceover = vi.fn().mockResolvedValue(undefined);
    wrap(
      <AiVideoDialog
        fetch={fetchMock as never}
        toaster={toaster}
        onResult={onResult}
        onGenerateVoiceover={onGenerateVoiceover}
      />
    );
    fireEvent.change(await screen.findByPlaceholderText('Describe the video you want to generate...'), {
      target: { value: 'a product commercial' },
    });
    fireEvent.click(screen.getByLabelText('Include voiceover (faceless video)'));
    fireEvent.change(await screen.findByLabelText('Narration script'), { target: { value: 'Try it today' } });
    fireEvent.change(await screen.findByLabelText('Voice provider:'), { target: { value: 'heygen' } });
    fireEvent.change(await screen.findByLabelText('Voice'), { target: { value: 'voice-1' } });
    fireEvent.change(screen.getByLabelText('Tone / style (optional)'), { target: { value: 'warm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(onGenerateVoiceover).toHaveBeenCalledWith('Try it today', 'voice-1', 'warm', 'heygen'));
    expect(onResult).toHaveBeenCalledBefore(onGenerateVoiceover);
  });

  it('requires narration and a voice before allowing a faceless generation', async () => {
    wrap(
      <AiVideoDialog
        fetch={fetchMock as never}
        toaster={toaster}
        onResult={vi.fn()}
        onGenerateVoiceover={vi.fn()}
      />
    );
    fireEvent.change(await screen.findByPlaceholderText('Describe the video you want to generate...'), {
      target: { value: 'a product commercial' },
    });
    fireEvent.click(screen.getByLabelText('Include voiceover (faceless video)'));
    fireEvent.change(await screen.findByLabelText('Narration script'), { target: { value: 'Try it today' } });

    expect((screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(true);
    expect(callsTo('/media/generate-video')).toHaveLength(0);
  });

  it('does not bill a voiceover when the visual generation fails', async () => {
    const onResult = vi.fn().mockResolvedValue(false);
    const onGenerateVoiceover = vi.fn().mockResolvedValue(undefined);
    wrap(
      <AiVideoDialog
        fetch={fetchMock as never}
        toaster={toaster}
        onResult={onResult}
        onGenerateVoiceover={onGenerateVoiceover}
      />
    );
    fireEvent.change(await screen.findByPlaceholderText('Describe the video you want to generate...'), {
      target: { value: 'a product commercial' },
    });
    fireEvent.click(screen.getByLabelText('Include voiceover (faceless video)'));
    fireEvent.change(await screen.findByLabelText('Narration script'), { target: { value: 'Try it today' } });
    fireEvent.change(await screen.findByLabelText('Voice'), { target: { value: 'voice-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(onGenerateVoiceover).not.toHaveBeenCalled();
  });
});

describe('MusicDialog provider picker wiring', () => {
  it('posts the unchanged legacy payload on the Default path', async () => {
    const onResult = vi.fn();
    wrap(<MusicDialog fetch={fetchMock as never} toaster={toaster} onResult={onResult} />);
    fireEvent.change(await screen.findByPlaceholderText('Describe the music you want to generate...'), {
      target: { value: 'lo-fi beats' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(callsTo('/media/generate-music')).toHaveLength(1));
    const [, init] = callsTo('/media/generate-music')[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ prompt: 'lo-fi beats' });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('audio', 'legacy-music-job'));
  });

  it('hides the legacy Generate when a provider is picked', async () => {
    wrap(<MusicDialog fetch={fetchMock as never} toaster={toaster} onResult={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText('Describe the music you want to generate...'), {
      target: { value: 'lo-fi beats' },
    });
    const select = (await screen.findByLabelText('Provider:')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'suno' } });

    const generate = await screen.findByRole('button', { name: 'Generate' });
    expect(screen.getAllByRole('button', { name: 'Generate' })).toHaveLength(1);
    fireEvent.click(generate);

    await waitFor(() => expect(callsTo('/media/studio/suno/generate')).toHaveLength(1));
    expect(callsTo('/media/generate-music')).toHaveLength(0);
    const [, init] = callsTo('/media/studio/suno/generate')[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.operation).toBe('audio');
    expect(body.input.prompt).toBe('lo-fi beats');
  });
});
