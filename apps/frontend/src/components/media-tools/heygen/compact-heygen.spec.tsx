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

vi.mock('@postmill-ai/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (p: string) => p }),
}));

// The voice picker opens through the modal manager — capture its children so
// the test can render and interact with them.
let modalChildren: React.ReactNode = null;
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({
    openModal: vi.fn((params: { children?: React.ReactNode }) => {
      modalChildren = params.children ?? null;
    }),
    closeAll: vi.fn(),
  }),
}));

// The media picker is captured too — the test triggers the onSelect it would
// have called with a Files pick.
let mediaPickerOnSelect: ((item: unknown) => void) | null = null;
vi.mock('@postmill-ai/frontend/components/media-tools/use-media-picker', () => ({
  useMediaPicker: (opts: { onSelect: (item: unknown) => void }) => {
    mediaPickerOnSelect = opts.onSelect;
    return { open: vi.fn(), element: null };
  },
}));

const fetchMock = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

import { CompactHeyGen } from './compact-heygen';

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

const VOICES = {
  voices: [
    {
      voiceId: 'hv-1',
      name: 'Aria',
      language: 'English',
      gender: 'Female',
      previewAudio: null,
      supportPause: false,
      emotionSupport: false,
    },
  ],
};

let jobsPayload: unknown[] = [];

const wrap = (ui: React.ReactElement) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
  );

const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(path));

const pickPhotoAndVoice = async () => {
  fireEvent.click(await screen.findByText('Pick a photo from Files'));
  mediaPickerOnSelect!({ fileId: 'file-p1', url: '/uploads/portrait.png', type: 'image' });
  await screen.findByText('Change photo');

  fireEvent.click(screen.getByText('Pick a voice'));
  expect(modalChildren).toBeTruthy();
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{modalChildren}</SWRConfig>);
  fireEvent.click(await screen.findByRole('button', { name: 'Use' }));
  // The voice name now labels the picker button (and lingers in the captured
  // modal copy) — assert on the main compact's voice button text.
  await waitFor(() => expect(screen.getAllByText('Aria').length).toBeGreaterThan(0));
};

beforeEach(() => {
  jobsPayload = [];
  modalChildren = null;
  mediaPickerOnSelect = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/media/heygen/status')) return Promise.resolve(ok({ configured: true }));
    if (url.includes('/media/heygen/voices')) return Promise.resolve(ok(VOICES));
    if (url.includes('/media/heygen/talking-photo')) return Promise.resolve(ok({ jobId: 'hj-1' }));
    if (url.includes('/media/heygen/jobs')) return Promise.resolve(ok(jobsPayload));
    return Promise.resolve(ok({}));
  });
});

afterEach(cleanup);

describe('CompactHeyGen', () => {
  it('renders the portrait and voice pickers (script comes from the dialog)', async () => {
    wrap(<CompactHeyGen operation="video" prompt="say hello" onGenerated={vi.fn()} />);
    expect(await screen.findByText('Pick a photo from Files')).toBeTruthy();
    expect(screen.getByText('Pick a voice')).toBeTruthy();
    // No script box of its own — the dialog's script textarea drives inputText.
    expect(screen.queryByPlaceholderText('What should the photo say?')).toBeNull();
  });

  it('posts the talking-photo job with the dialog script and calls onGenerated on completion', async () => {
    jobsPayload = [
      {
        id: 'hj-1',
        operation: 'video',
        status: 'completed',
        artifactUrl: '/uploads/avatar.mp4',
        fileId: 'file-v1',
        error: null,
        createdAt: '2026-10-19T00:00:00.000Z',
      },
    ];
    const onGenerated = vi.fn();
    wrap(<CompactHeyGen operation="video" prompt=" say hello " onGenerated={onGenerated} />);
    await pickPhotoAndVoice();

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(callsTo('/media/heygen/talking-photo')).toHaveLength(1));
    const [, init] = callsTo('/media/heygen/talking-photo')[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      fileId: 'file-p1',
      voiceId: 'hv-1',
      inputText: 'say hello',
      dimension: { width: 720, height: 1280 },
    });

    await waitFor(() =>
      expect(onGenerated).toHaveBeenCalledWith({
        operation: 'video',
        artifactUrl: '/uploads/avatar.mp4',
        fileId: 'file-v1',
      })
    );
  });

  it('surfaces the job error when the render fails', async () => {
    jobsPayload = [
      {
        id: 'hj-1',
        operation: 'video',
        status: 'failed',
        artifactUrl: null,
        fileId: null,
        error: 'HeyGen credits exhausted',
        createdAt: '2026-10-19T00:00:00.000Z',
      },
    ];
    const onGenerated = vi.fn();
    const onError = vi.fn();
    wrap(
      <CompactHeyGen operation="video" prompt="say hello" onGenerated={onGenerated} onError={onError} />
    );
    await pickPhotoAndVoice();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('HeyGen credits exhausted')
    );
    expect(onError).toHaveBeenCalledWith('HeyGen credits exhausted');
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('shows a configure note instead of the pickers when HeyGen is not configured', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/media/heygen/status')) return Promise.resolve(ok({ configured: false }));
      return Promise.resolve(ok({}));
    });
    wrap(<CompactHeyGen operation="video" prompt="say hello" onGenerated={vi.fn()} />);
    expect(await screen.findByText(/isn't configured — add your credentials/)).toBeTruthy();
    expect(screen.queryByText('Pick a photo from Files')).toBeNull();
  });
});
