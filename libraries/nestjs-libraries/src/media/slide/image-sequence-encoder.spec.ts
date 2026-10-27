import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.fn();
const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(true);

vi.mock('fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { encodeImageSequenceToMp4 } from './image-sequence-encoder';

function ffmpegProcess(exitCode = 0, stderr = '') {
  return {
    stderr: {
      on: vi.fn().mockImplementation((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data' && stderr) setTimeout(() => callback(Buffer.from(stderr)), 0);
      }),
    },
    on: vi.fn().mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'close') setTimeout(() => callback(exitCode), 0);
    }),
    kill: vi.fn(),
  };
}

describe('encodeImageSequenceToMp4', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockImplementation(() => ffmpegProcess());
  });

  it('preserves slide order and durations, normalizes the canvas, and adds silent faststart H264/AAC output', async () => {
    await encodeImageSequenceToMp4([
      { imagePath: '/tmp/first.jpg', durationSeconds: 1.25 },
      { imagePath: '/tmp/second.jpg', durationSeconds: 2.5 },
    ], '/tmp/output.mp4', {
      targetWidth: 1080,
      targetHeight: 1920,
      fitMode: 'contain',
    });

    expect(mockSpawn).toHaveBeenCalledTimes(3);
    const concat = mockWriteFileSync.mock.calls.find((call) => call[0] === '/tmp/concat.txt');
    expect(concat?.[1]).toBe([
      "file '/tmp/slide-0.norm.png'",
      'duration 1.250',
      "file '/tmp/slide-1.norm.png'",
      'duration 2.500',
      "file '/tmp/slide-1.norm.png'",
    ].join('\n'));
    expect(mockSpawn.mock.calls[0][1]).toContain(
      'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1',
    );
    const finalArgs = mockSpawn.mock.calls[2][1] as string[];
    expect(finalArgs).toEqual(expect.arrayContaining([
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      'libx264',
      'yuv420p',
      'aac',
      '+faststart',
      '3.750',
    ]));
    expect(finalArgs).not.toContain('-shortest');
  });

  it('mixes supplied narration instead of adding the silent input', async () => {
    await encodeImageSequenceToMp4([
      { imagePath: '/tmp/first.jpg', audioPath: '/tmp/first.mp3', durationSeconds: 1 },
      { imagePath: '/tmp/second.jpg', audioPath: '/tmp/second.mp3', durationSeconds: 2 },
    ], '/tmp/output.mp4', { minDurationSeconds: 3 });

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    const finalArgs = mockSpawn.mock.calls[1][1] as string[];
    expect(finalArgs).toContain('/tmp/mixed-audio.wav');
    expect(finalArgs.some((arg) => arg.includes('anullsrc'))).toBe(false);
    expect(finalArgs).toContain('6.000');
  });

  it('rejects empty sequences and invalid durations before invoking ffmpeg', async () => {
    await expect(encodeImageSequenceToMp4([], '/tmp/output.mp4')).rejects.toThrow('At least one slide');
    await expect(encodeImageSequenceToMp4([
      { imagePath: '/tmp/first.jpg', durationSeconds: Number.NaN },
    ], '/tmp/output.mp4')).rejects.toThrow('positive finite');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('surfaces bounded ffmpeg errors', async () => {
    mockSpawn.mockImplementation(() => ffmpegProcess(1, 'invalid image data'));

    await expect(encodeImageSequenceToMp4([
      { imagePath: '/tmp/broken.jpg', durationSeconds: 1 },
    ], '/tmp/output.mp4')).rejects.toThrow('ffmpeg exited 1: invalid image data');
  });
});
