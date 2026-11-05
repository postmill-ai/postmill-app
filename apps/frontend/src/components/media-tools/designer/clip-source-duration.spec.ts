import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { getSourceDurationMs, SOURCE_DURATION_RETRY_MS, useSourceDurationMs } from './clip-source-duration';
import { probeAudioMetadata, probeVideoMetadata } from './add-media-to-timeline';

vi.mock('./add-media-to-timeline', () => ({
  probeAudioMetadata: vi.fn(),
  probeVideoMetadata: vi.fn(),
}));

describe('useSourceDurationMs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-renders when the probe resolves and retries a failed source after a backoff', async () => {
    let resolveProbe!: (value: { durationMs: number }) => void;
    vi.mocked(probeVideoMetadata).mockImplementationOnce(() => new Promise((resolve) => {
      resolveProbe = resolve;
    }));
    const { result, unmount } = renderHook(() => useSourceDurationMs('/video.mp4', 'video'));
    expect(result.current).toBeUndefined();
    resolveProbe({ durationMs: 6000 });
    await waitFor(() => expect(result.current).toBe(6000));
    unmount();

    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(probeVideoMetadata).mockRejectedValueOnce(new Error('decode failed'));
    expect(() => getSourceDurationMs('/broken.mp4', 'video')).not.toThrow();
    await waitFor(() => expect(probeVideoMetadata).toHaveBeenCalledTimes(2));
    vi.mocked(probeVideoMetadata).mockResolvedValueOnce({ durationMs: 7000 });
    expect(getSourceDurationMs('/broken.mp4', 'video')).toBeUndefined();
    expect(probeVideoMetadata).toHaveBeenCalledTimes(2);

    now += SOURCE_DURATION_RETRY_MS + 1;
    expect(getSourceDurationMs('/broken.mp4', 'video')).toBeUndefined();
    await waitFor(() => expect(getSourceDurationMs('/broken.mp4', 'video')).toBe(7000));
    expect(probeVideoMetadata).toHaveBeenCalledTimes(3);
  });

  it('does not cache a fallback duration returned for a failed probe', async () => {
    let now = 5000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(probeAudioMetadata).mockResolvedValueOnce({ durationMs: 10000, probeFailed: true });
    expect(getSourceDurationMs('/broken.mp3', 'audio')).toBeUndefined();
    await waitFor(() => expect(probeAudioMetadata).toHaveBeenCalledTimes(1));

    vi.mocked(probeAudioMetadata).mockResolvedValueOnce({ durationMs: 42000 });
    expect(getSourceDurationMs('/broken.mp3', 'audio')).toBeUndefined();
    expect(probeAudioMetadata).toHaveBeenCalledTimes(1);
    now += SOURCE_DURATION_RETRY_MS + 1;
    expect(getSourceDurationMs('/broken.mp3', 'audio')).toBeUndefined();
    await waitFor(() => expect(getSourceDurationMs('/broken.mp3', 'audio')).toBe(42000));
  });
});
