import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import {
  VoiceoverRecordDialog,
  pickRecordingMimeType,
  MAX_VOICEOVER_RECORD_MS,
} from './voiceover-record-dialog';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

afterEach(cleanup);

// --- Browser API fakes -------------------------------------------------------

const makeTrack = () => ({ stop: vi.fn() });
const makeStream = () => {
  const tracks = [makeTrack(), makeTrack()];
  return { getTracks: () => tracks } as unknown as MediaStream;
};

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static isTypeSupported = vi.fn(
    (mime: string) => mime === 'audio/webm;codecs=opus' || mime === 'audio/webm'
  );
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown, public options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    MockMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob(['audio-bytes'], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}

const stubMediaDevices = (impl?: () => Promise<MediaStream>) => {
  const getUserMedia = vi.fn(
    impl ?? (() => Promise.resolve(makeStream() as unknown as MediaStream))
  );
  const enumerateDevices = vi.fn().mockResolvedValue([
    { kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in Mic' },
    { kind: 'audioinput', deviceId: 'mic-2', label: 'USB Mic' },
  ]);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia, enumerateDevices },
    configurable: true,
  });
  return { getUserMedia, enumerateDevices };
};

beforeEach(() => {
  MockMediaRecorder.instances = [];
  // mockImplementation (not just mockClear): the preference-order describe
  // leaves a `false` implementation behind otherwise.
  MockMediaRecorder.isTypeSupported.mockImplementation(
    (mime: string) => mime === 'audio/webm;codecs=opus' || mime === 'audio/webm'
  );
  vi.stubGlobal('MediaRecorder', MockMediaRecorder);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pickRecordingMimeType', () => {
  it('prefers opus-in-webm, then mp4, then ogg', () => {
    MockMediaRecorder.isTypeSupported.mockImplementation(
      (m: string) => m === 'audio/webm;codecs=opus'
    );
    expect(pickRecordingMimeType()).toBe('audio/webm;codecs=opus');

    MockMediaRecorder.isTypeSupported.mockImplementation(
      (m: string) => m === 'audio/mp4'
    );
    expect(pickRecordingMimeType()).toBe('audio/mp4');

    MockMediaRecorder.isTypeSupported.mockImplementation(
      (m: string) => m === 'audio/ogg;codecs=opus'
    );
    expect(pickRecordingMimeType()).toBe('audio/ogg;codecs=opus');

    MockMediaRecorder.isTypeSupported.mockImplementation(() => false);
    expect(pickRecordingMimeType()).toBe('');
  });
});

describe('VoiceoverRecordDialog', () => {
  it('requests the mic on open with echo cancellation and noise suppression', async () => {
    const { getUserMedia } = stubMediaDevices();
    render(<VoiceoverRecordDialog onClose={vi.fn()} onAdd={vi.fn()} />);

    expect(screen.getByText('Requesting microphone…')).toBeTruthy();
    await screen.findByText('● Record');
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  });

  it('offers the mic selector once labels are unlocked', async () => {
    stubMediaDevices();
    render(<VoiceoverRecordDialog onClose={vi.fn()} onAdd={vi.fn()} />);

    const select = (await screen.findByLabelText(
      'Microphone'
    )) as HTMLSelectElement;
    expect(select.options).toHaveLength(3); // Default + 2 devices
  });

  it('shows guidance and a retry on NotAllowedError', async () => {
    const { getUserMedia } = stubMediaDevices(() =>
      Promise.reject(new DOMException('denied', 'NotAllowedError'))
    );
    render(<VoiceoverRecordDialog onClose={vi.fn()} onAdd={vi.fn()} />);

    await screen.findByText(/Microphone access was denied/);
    fireEvent.click(screen.getByText('Retry'));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('reports a missing microphone on NotFoundError', async () => {
    stubMediaDevices(() =>
      Promise.reject(new DOMException('none', 'NotFoundError'))
    );
    render(<VoiceoverRecordDialog onClose={vi.fn()} onAdd={vi.fn()} />);

    await screen.findByText(/No microphone found/);
  });

  it('disables recording when MediaRecorder is unavailable', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    stubMediaDevices();
    render(<VoiceoverRecordDialog onClose={vi.fn()} onAdd={vi.fn()} />);

    await screen.findByText('Recording is not supported in this browser.');
    expect(screen.queryByText('● Record')).toBeNull();
  });

  it('records, previews, re-records and adds to the timeline', async () => {
    stubMediaDevices();
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<VoiceoverRecordDialog onClose={onClose} onAdd={onAdd} />);

    fireEvent.click(await screen.findByText('● Record'));
    const recorder = MockMediaRecorder.instances[0];
    expect(recorder.state).toBe('recording');
    expect(recorder.options?.mimeType).toBe('audio/webm;codecs=opus');

    fireEvent.click(screen.getByText('■ Stop'));
    // onstop builds the preview blob and moves to review.
    const audio = await waitFor(() =>
      document.querySelector('audio')
    );
    expect(audio).toBeTruthy();
    expect(audio!.src.startsWith('blob:')).toBe(true);

    // Re-record discards the take and returns to ready.
    fireEvent.click(screen.getByText('Re-record'));
    await screen.findByText('● Record');

    fireEvent.click(screen.getByText('● Record'));
    fireEvent.click(screen.getByText('■ Stop'));
    await waitFor(() => document.querySelector('audio'));

    fireEvent.click(screen.getByText('Add to timeline'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const [blob, mime] = onAdd.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(mime).toBe('audio/webm;codecs=opus');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('auto-stops at the 180s cap', async () => {
    stubMediaDevices();
    render(<VoiceoverRecordDialog onClose={vi.fn()} onAdd={vi.fn()} />);

    fireEvent.click(await screen.findByText('● Record'));
    const recorder = MockMediaRecorder.instances[0];
    expect(recorder.state).toBe('recording');

    // Jump the clock past the cap; the 250ms ticker stops the recorder.
    const realNow = Date.now();
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow + offset);
    offset = MAX_VOICEOVER_RECORD_MS + 1000;

    await waitFor(
      () => expect(recorder.state).toBe('inactive'),
      { timeout: 2000 }
    );
    await waitFor(() => document.querySelector('audio'));
  });

  it('stops the mic tracks on unmount', async () => {
    const stream = makeStream();
    stubMediaDevices(() => Promise.resolve(stream as unknown as MediaStream));
    const { unmount } = render(
      <VoiceoverRecordDialog onClose={vi.fn()} onAdd={vi.fn()} />
    );

    await screen.findByText('● Record');
    unmount();
    for (const track of (stream as any).getTracks()) {
      expect(track.stop).toHaveBeenCalled();
    }
  });
});
