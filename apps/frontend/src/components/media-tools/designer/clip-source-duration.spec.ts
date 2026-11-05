import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { getSourceDurationMs, useSourceDurationMs } from './clip-source-duration';
import { probeVideoMetadata } from './add-media-to-timeline';

vi.mock('./add-media-to-timeline', () => ({
  probeAudioDuration: vi.fn(),
  probeVideoMetadata: vi.fn(),
}));

describe('useSourceDurationMs', () => {
  it('re-renders when the probe resolves and retries a failed source', async () => {
    let resolveProbe!: (value: { durationMs: number }) => void;
    vi.mocked(probeVideoMetadata).mockImplementationOnce(() => new Promise((resolve) => {
      resolveProbe = resolve;
    }));
    const { result, unmount } = renderHook(() => useSourceDurationMs('/video.mp4', 'video'));
    expect(result.current).toBeUndefined();
    resolveProbe({ durationMs: 6000 });
    await waitFor(() => expect(result.current).toBe(6000));
    unmount();

    vi.mocked(probeVideoMetadata).mockRejectedValueOnce(new Error('decode failed'));
    expect(() => getSourceDurationMs('/broken.mp4', 'video')).not.toThrow();
    await waitFor(() => expect(probeVideoMetadata).toHaveBeenCalledTimes(2));
    vi.mocked(probeVideoMetadata).mockResolvedValueOnce({ durationMs: 7000 });
    await waitFor(() => expect(probeVideoMetadata).toHaveBeenCalledTimes(2));
    expect(getSourceDurationMs('/broken.mp4', 'video')).toBeUndefined();
    await waitFor(() => expect(probeVideoMetadata).toHaveBeenCalledTimes(3));
    expect(getSourceDurationMs('/broken.mp4', 'video')).toBe(7000);
  });
});
