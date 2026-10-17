import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  VideoSegmentTransformService,
  MAX_SEGMENT_SPAN_MS,
} from './video-segment-transform.service';

const mockSafeFetch = vi.fn();

vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (...args: any[]) => mockSafeFetch(...args),
}));

const mockSpawn = vi.fn();
const mockMkdtempSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockRmSync = vi.fn();

vi.mock('fs', () => ({
  mkdtempSync: (...args: any[]) => mockMkdtempSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  rmSync: (...args: any[]) => mockRmSync(...args),
  existsSync: () => false,
}));

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

const fakeSegmentBuffer = Buffer.from('fake-segment-mp4-bytes');

function makeFfmpegProcess(exitCode: number, stderrText = '') {
  return {
    stderr: {
      on: (event: string, cb: (d: Buffer) => void) => {
        if (event === 'data' && stderrText) setTimeout(() => cb(Buffer.from(stderrText)), 0);
      },
    },
    on: (event: string, cb: (...args: any[]) => void) => {
      if (event === 'close') setTimeout(() => cb(exitCode), 0);
    },
  };
}

// Probe (`ffmpeg -i <src>`) exits 1 with the container dump on stderr; the trim
// invocation carries -ss/-t and exits 0.
function mockFfmpeg(durationStderr: string) {
  mockSpawn.mockImplementation((_bin: string, args: string[]) =>
    args.includes('-ss') ? makeFfmpegProcess(0) : makeFfmpegProcess(1, durationStderr),
  );
}

function makeService() {
  const aiDefaults = {
    videoToVideo: vi.fn().mockResolvedValue('job-1'),
  };
  const lifecycle = {
    storeInputArtifact: vi.fn().mockResolvedValue({
      mediaId: 'media-1',
      path: 'https://cdn.example.com/uploads/segment.mp4',
      fileSize: fakeSegmentBuffer.length,
    }),
  };
  const storage = {
    resolveAdapterForFolder: vi.fn(),
    getLocalAdapterForOrg: vi.fn(),
  };
  const fileService = {
    getFileByPath: vi.fn().mockResolvedValue(null),
  };

  return {
    service: new VideoSegmentTransformService(
      aiDefaults as never,
      lifecycle as never,
      storage as never,
      fileService as never,
    ),
    mocks: { aiDefaults, lifecycle, storage, fileService },
  };
}

describe('VideoSegmentTransformService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from('fake-source-mp4-bytes').buffer,
      headers: {
        get: (name: string) =>
          name === 'content-type' ? 'video/mp4' : null,
      },
    });
    mockMkdtempSync.mockReturnValue('/tmp/postmill-segment-xxx');
    mockReadFileSync.mockReturnValue(fakeSegmentBuffer);
    mockFfmpeg('Input #0, mov,mp4\n  Duration: 00:00:10.00, start: 0.000000\n  Stream #0:0: Video');
  });

  it('rejects trimEndMs <= trimStartMs before touching the network', async () => {
    const { service } = makeService();
    await expect(
      service.transformSegment('org-1', {
        videoUrl: 'https://example.com/v.mp4',
        prompt: 'p',
        trimStartMs: 2000,
        trimEndMs: 2000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('rejects a span beyond the 30s cap', async () => {
    const { service } = makeService();
    await expect(
      service.transformSegment('org-1', {
        videoUrl: 'https://example.com/v.mp4',
        prompt: 'p',
        trimStartMs: 0,
        trimEndMs: MAX_SEGMENT_SPAN_MS + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('rejects a window fully outside the probed source duration', async () => {
    const { service } = makeService();
    await expect(
      service.transformSegment('org-1', {
        videoUrl: 'https://example.com/v.mp4',
        prompt: 'p',
        trimStartMs: 9500,
        trimEndMs: 12000, // clamps to 10000 — inside, but…
      }),
    ).resolves.toBe('job-1');

    mockFfmpeg('  Duration: 00:00:05.00, start: 0.000000\n');
    await expect(
      service.transformSegment('org-1', {
        videoUrl: 'https://example.com/v.mp4',
        prompt: 'p',
        trimStartMs: 6000,
        trimEndMs: 8000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('re-encodes the trim (never stream-copies) and transforms the stored segment URL', async () => {
    const { service, mocks } = makeService();
    const result = await service.transformSegment('org-1', {
      videoUrl: 'https://example.com/v.mp4',
      prompt: 'make it anime',
      trimStartMs: 2000,
      trimEndMs: 5000,
    });

    expect(result).toBe('job-1');

    const trimArgs = mockSpawn.mock.calls.find(([, args]) => (args as string[]).includes('-ss'))?.[1] as string[];
    expect(trimArgs).toContain('-c:v');
    expect(trimArgs).toContain('libx264');
    expect(trimArgs).not.toContain('copy');
    expect(trimArgs[trimArgs.indexOf('-ss') + 1]).toBe('2.000');
    expect(trimArgs[trimArgs.indexOf('-t') + 1]).toBe('3.000');

    expect(mocks.lifecycle.storeInputArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', mime: 'video/mp4' }),
    );
    expect(mocks.aiDefaults.videoToVideo).toHaveBeenCalledWith(
      'org-1',
      'make it anime',
      'https://cdn.example.com/uploads/segment.mp4',
    );
    expect(mockRmSync).toHaveBeenCalled();
  });

  it('clamps trimEndMs to the probed duration', async () => {
    const { service } = makeService();
    await service.transformSegment('org-1', {
      videoUrl: 'https://example.com/v.mp4',
      prompt: 'p',
      trimStartMs: 1000,
      trimEndMs: 31000, // clamps to 10000
    });
    const trimArgs = mockSpawn.mock.calls.find(([, args]) => (args as string[]).includes('-ss'))?.[1] as string[];
    expect(trimArgs[trimArgs.indexOf('-t') + 1]).toBe('9.000');
  });

  it('passes the original URL straight to video-to-video when the window covers the whole source', async () => {
    const { service, mocks } = makeService();
    await service.transformSegment('org-1', {
      videoUrl: 'https://example.com/v.mp4',
      prompt: 'p',
      trimStartMs: 0,
      trimEndMs: 10000,
    });
    expect(mocks.lifecycle.storeInputArtifact).not.toHaveBeenCalled();
    expect(mocks.aiDefaults.videoToVideo).toHaveBeenCalledWith('org-1', 'p', 'https://example.com/v.mp4');
  });

  it('reads org-storage files through the storage adapter instead of safeFetch', async () => {
    const { service, mocks } = makeService();
    const adapter = { readFile: vi.fn().mockResolvedValue(Buffer.from('stored-video')) };
    mocks.fileService.getFileByPath.mockResolvedValue({ path: '/uploads/v.mp4', folderId: null });
    mocks.storage.getLocalAdapterForOrg.mockResolvedValue(adapter);

    await service.transformSegment('org-1', {
      videoUrl: 'https://app.postmill.ai/uploads/v.mp4',
      prompt: 'p',
      trimStartMs: 1000,
      trimEndMs: 4000,
    });

    expect(adapter.readFile).toHaveBeenCalledWith('/uploads/v.mp4');
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });
});
