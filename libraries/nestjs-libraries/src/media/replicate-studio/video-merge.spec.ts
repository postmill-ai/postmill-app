import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSafeFetch = vi.fn();
vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (...args: any[]) => mockSafeFetch(...args),
}));

const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockUnlink = vi.fn();
const mockMkdtemp = vi.fn();
const mockRm = vi.fn();

vi.mock('fs/promises', () => ({
  writeFile: (...args: any[]) => mockWriteFile(...args),
  readFile: (...args: any[]) => mockReadFile(...args),
  unlink: (...args: any[]) => mockUnlink(...args),
  mkdtemp: (...args: any[]) => mockMkdtemp(...args),
  rm: (...args: any[]) => mockRm(...args),
}));

import { mergeClips } from './video-merge';

const MAX_CLIP_SIZE = 500 * 1024 * 1024;

const WORK_DIR = '/tmp/replicate-merge-test';

function clipPath(index: number) {
  return `${WORK_DIR}/clip_${index}.mp4`;
}

function setExecFileMock(
  durationMap: Record<string, number> = {},
  ffmpegSuccess = true,
) {
  mockExecFile.mockImplementation((...args: any[]) => {
    const callback = args[args.length - 1] as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    const cmd = args[0] as string;
    const cmdArgs = (args[1] ?? []) as string[];

    if (cmd === 'ffprobe') {
      const filePath = cmdArgs.find((a) => a.endsWith('.mp4')) || '';
      const duration = durationMap[filePath] ?? 10;
      callback(null, String(duration), '');
      return undefined as any;
    }

    if (cmd === 'ffmpeg') {
      if (!ffmpegSuccess) {
        callback(new Error('ffmpeg failed'), '', '');
        return undefined as any;
      }
      callback(null, '', '');
      return undefined as any;
    }

    callback(new Error(`Unexpected command: ${cmd}`), '', '');
    return undefined as any;
  });
}

function mockStorageWithBuffer(buffer: Buffer) {
  return {
    resolveAdapterForFolder: vi.fn().mockResolvedValue({
      readFile: vi.fn().mockResolvedValue(buffer),
    }),
  } as any;
}

function mockUrlResponse(buffer: Buffer) {
  mockSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => buffer,
  });
}

function getFfmpegArgs(): string[] {
  const call = mockExecFile.mock.calls.find((c) => c[0] === 'ffmpeg');
  expect(call).toBeDefined();
  return (call![1] as string[]) ?? [];
}

describe('mergeClips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFile.mockReset();
    mockSafeFetch.mockReset();
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(Buffer.from('merged'));
    mockUnlink.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockMkdtemp.mockResolvedValue(WORK_DIR);
  });

  it('uses -c copy for a single clip', async () => {
    setExecFileMock();
    mockUrlResponse(Buffer.alloc(1024));

    await mergeClips(
      [{ url: 'https://example.com/clip.mp4' }],
      [],
      'org1',
      mockStorageWithBuffer(Buffer.alloc(1024)),
      async (fileId) => `/storage/${fileId}`,
    );

    const args = getFfmpegArgs();
    expect(args).toContain('-c');
    expect(args[args.indexOf('-c') + 1]).toBe('copy');
    expect(args).not.toContain('-filter_complex');
  });

  it('builds a valid filter_complex for multi-clip merges', async () => {
    setExecFileMock({
      [clipPath(0)]: 5,
      [clipPath(1)]: 4,
      [clipPath(2)]: 6,
    });
    mockUrlResponse(Buffer.alloc(1024));

    await mergeClips(
      [
        { url: 'https://example.com/a.mp4' },
        { url: 'https://example.com/b.mp4' },
        { url: 'https://example.com/c.mp4' },
      ],
      [{ type: 'fade' }, { type: 'fade' }],
      'org1',
      mockStorageWithBuffer(Buffer.alloc(1024)),
      async (fileId) => `/storage/${fileId}`,
    );

    const args = getFfmpegArgs();
    const filterIdx = args.indexOf('-filter_complex');
    expect(filterIdx).toBeGreaterThan(-1);
    const filterComplex = args[filterIdx + 1];

    // Video chain uses xfade only on video labels.
    expect(filterComplex).toContain('[0:v][1:v]xfade=transition=fade:duration=0.5:offset=4.5[v1];');
    expect(filterComplex).toContain('[v1][2:v]xfade=transition=fade:duration=0.5:offset=8[v2];');

    // Audio chain uses acrossfade with bracketed labels.
    expect(filterComplex).toContain('[0:a][1:a]acrossfade=d=0.5[a1];');
    expect(filterComplex).toContain('[a1][2:a]acrossfade=d=0.5[a2];');

    // Audio labels never leak into the xfade expression.
    expect(filterComplex).not.toMatch(/xfade=[^[]*\[\d:a\]/);

    // Maps to final chained outputs.
    expect(args).toContain('-map');
    const mapIdx = args.indexOf('-map');
    expect(args[mapIdx + 1]).toBe('v2');
    expect(args[mapIdx + 3]).toBe('a2');
  });

  it('applies custom transition type and duration', async () => {
    setExecFileMock({
      [clipPath(0)]: 10,
      [clipPath(1)]: 10,
    });
    mockUrlResponse(Buffer.alloc(1024));

    await mergeClips(
      [
        { url: 'https://example.com/a.mp4' },
        { url: 'https://example.com/b.mp4' },
      ],
      [{ type: 'xfade-wipe', duration: 1 }],
      'org1',
      mockStorageWithBuffer(Buffer.alloc(1024)),
      async (fileId) => `/storage/${fileId}`,
    );

    const args = getFfmpegArgs();
    const filterIdx = args.indexOf('-filter_complex');
    const filterComplex = args[filterIdx + 1];

    expect(filterComplex).toContain('[0:v][1:v]xfade=transition=wiperight:duration=1:offset=9[v1];');
    expect(filterComplex).toContain('[0:a][1:a]acrossfade=d=1[a1];');
  });

  it('falls back to fade for unknown transition types', async () => {
    setExecFileMock({
      [clipPath(0)]: 10,
      [clipPath(1)]: 10,
    });
    mockUrlResponse(Buffer.alloc(1024));

    await mergeClips(
      [
        { url: 'https://example.com/a.mp4' },
        { url: 'https://example.com/b.mp4' },
      ],
      [{ type: 'unknown-effect' }],
      'org1',
      mockStorageWithBuffer(Buffer.alloc(1024)),
      async (fileId) => `/storage/${fileId}`,
    );

    const args = getFfmpegArgs();
    const filterIdx = args.indexOf('-filter_complex');
    const filterComplex = args[filterIdx + 1];

    expect(filterComplex).toContain('xfade=transition=fade');
  });

  it('fetches external URL clips via safeFetch', async () => {
    setExecFileMock();
    mockUrlResponse(Buffer.alloc(1024));

    await mergeClips(
      [{ url: 'https://cdn.example.com/video.mp4' }],
      [],
      'org1',
      mockStorageWithBuffer(Buffer.alloc(1024)),
      async (fileId) => `/storage/${fileId}`,
    );

    expect(mockSafeFetch).toHaveBeenCalledWith('https://cdn.example.com/video.mp4');
  });

  it('reads fileId clips through the storage adapter', async () => {
    setExecFileMock();
    const storage = mockStorageWithBuffer(Buffer.alloc(1024));

    await mergeClips(
      [{ fileId: 'file-123' }],
      [],
      'org1',
      storage,
      async (fileId) => `/storage/${fileId}`,
    );

    expect(storage.resolveAdapterForFolder).toHaveBeenCalledWith(null, 'org1');
  });

  it('enforces the 6-clip limit', async () => {
    await expect(
      mergeClips(
        Array.from({ length: 7 }, (_, i) => ({ url: `https://example.com/${i}.mp4` })),
        [],
        'org1',
        mockStorageWithBuffer(Buffer.alloc(1024)),
        async (fileId) => `/storage/${fileId}`,
      ),
    ).rejects.toThrow('Maximum 6 clips allowed');
  });

  it('enforces the per-clip 500 MB limit', async () => {
    mockUrlResponse(Buffer.alloc(MAX_CLIP_SIZE + 1));

    await expect(
      mergeClips(
        [{ url: 'https://example.com/big.mp4' }],
        [],
        'org1',
        mockStorageWithBuffer(Buffer.alloc(1024)),
        async (fileId) => `/storage/${fileId}`,
      ),
    ).rejects.toThrow('Clip 1 exceeds 500 MB limit');
  });

  it('enforces the total 1 GB limit', async () => {
    mockUrlResponse(Buffer.alloc(400 * 1024 * 1024));

    await expect(
      mergeClips(
        [
          { url: 'https://example.com/a.mp4' },
          { url: 'https://example.com/b.mp4' },
          { url: 'https://example.com/c.mp4' },
        ],
        [],
        'org1',
        mockStorageWithBuffer(Buffer.alloc(1024)),
        async (fileId) => `/storage/${fileId}`,
      ),
    ).rejects.toThrow('Total clip size exceeds 1 GB limit');
  });

  it('cleans up temp files even when ffmpeg fails', async () => {
    setExecFileMock(
      {
        [clipPath(0)]: 5,
        [clipPath(1)]: 5,
      },
      false,
    );
    mockUrlResponse(Buffer.alloc(1024));

    await expect(
      mergeClips(
        [
          { url: 'https://example.com/a.mp4' },
          { url: 'https://example.com/b.mp4' },
        ],
        [{ type: 'fade' }],
        'org1',
        mockStorageWithBuffer(Buffer.alloc(1024)),
        async (fileId) => `/storage/${fileId}`,
      ),
    ).rejects.toThrow('ffmpeg failed');

    // Cleanup is now a single recursive rm of the work dir (covers every temp file).
    expect(mockRm).toHaveBeenCalledWith(WORK_DIR, { recursive: true, force: true });
  });

  it('throws when duration cannot be determined', async () => {
    mockExecFile.mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1] as (
        err: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const cmd = args[0] as string;
      if (cmd === 'ffprobe') {
        callback(null, 'N/A', '');
        return undefined as any;
      }
      callback(new Error('unexpected'), '', '');
      return undefined as any;
    });
    mockUrlResponse(Buffer.alloc(1024));

    await expect(
      mergeClips(
        [
          { url: 'https://example.com/a.mp4' },
          { url: 'https://example.com/b.mp4' },
        ],
        [{ type: 'fade' }],
        'org1',
        mockStorageWithBuffer(Buffer.alloc(1024)),
        async (fileId) => `/storage/${fileId}`,
      ),
    ).rejects.toThrow('Could not determine duration');
  });
});
