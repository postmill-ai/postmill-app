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

vi.mock('@postmill-ai/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (p: string) => p }),
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

let AvatarDialog: (typeof import('./video-timeline'))['AvatarDialog'];

beforeAll(async () => {
  vi.stubGlobal('AudioContext', MockAudioContext);
  ({ AvatarDialog } = await import('./video-timeline'));
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
      return Promise.resolve(
        ok({
          providers: [
            { identifier: 'heygen', name: 'HeyGen' },
            { identifier: 'hedra', name: 'Hedra' },
            // Excluded for avatar: its video tab is a slideshow generator, not
            // an avatar tool (AVATAR_COMPACT_EXCLUDE).
            { identifier: 'reelfarm', name: 'Reel.Farm' },
          ],
          default: { providerId: 'heygen', model: 'avatar_iv' },
        })
      );
    }
    if (url.includes('/media/heygen/status')) return Promise.resolve(ok({ configured: true }));
    if (url.includes('/media/heygen/voices')) return Promise.resolve(ok({ voices: [] }));
    if (url.includes('/media/studio/hedra/status')) {
      return Promise.resolve(ok({ configured: true, enabled: true }));
    }
    if (url.includes('/media/generate-avatar')) return Promise.resolve(ok({ id: 'legacy-avatar-job' }));
    return Promise.resolve(ok({}));
  });
});

afterEach(cleanup);

describe('AvatarDialog provider picker wiring', () => {
  it('lists avatar providers with a compact studio (slideshow-only Reel.Farm excluded)', async () => {
    wrap(<AvatarDialog fetch={fetchMock as never} toaster={toaster} onResult={vi.fn()} />);
    expect(await screen.findByText('Default (heygen/avatar_iv)')).toBeTruthy();
    expect(await screen.findByText('HeyGen')).toBeTruthy();
    expect(screen.getByText('Hedra')).toBeTruthy();
    expect(screen.queryByText('Reel.Farm')).toBeNull();
  });

  it('posts the unchanged legacy payload on the Default path', async () => {
    const onResult = vi.fn();
    wrap(<AvatarDialog fetch={fetchMock as never} toaster={toaster} onResult={onResult} />);
    fireEvent.change(await screen.findByPlaceholderText('Enter the script for the avatar...'), {
      target: { value: 'say hi' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(callsTo('/media/generate-avatar')).toHaveLength(1));
    const [, init] = callsTo('/media/generate-avatar')[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ script: 'say hi' });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('video', 'legacy-avatar-job'));
  });

  it('hides the legacy controls and embeds the HeyGen compact when HeyGen is picked', async () => {
    wrap(<AvatarDialog fetch={fetchMock as never} toaster={toaster} onResult={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText('Enter the script for the avatar...'), {
      target: { value: 'say hi' },
    });
    const select = (await screen.findByLabelText('Provider:')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'heygen' } });

    // The compact talking-photo embed renders portrait + voice pickers; the
    // legacy portrait/Generate controls are gone (the only Generate left is
    // the compact's own).
    expect(await screen.findByText('Pick a photo from Files')).toBeTruthy();
    expect(screen.getByText('Pick a voice')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pick portrait' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Generate' })).toHaveLength(1);
    expect(callsTo('/media/generate-avatar')).toHaveLength(0);
  });

  it('embeds a descriptor avatar studio (Hedra) with its portrait field', async () => {
    wrap(<AvatarDialog fetch={fetchMock as never} toaster={toaster} onResult={vi.fn()} />);
    const select = (await screen.findByLabelText('Provider:')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'hedra' } });

    // Hedra's video tab: required portrait media field + aspect ratio; the
    // script textarea drives its prompt field (no prompt box of its own).
    expect(await screen.findByText('Portrait image')).toBeTruthy();
    expect(screen.getByText('Aspect ratio')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Describe the scene / performance…')).toBeNull();
  });
});
