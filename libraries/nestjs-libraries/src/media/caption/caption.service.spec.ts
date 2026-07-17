import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaptionService, MAX_WORDS_PER_SEGMENT } from './caption.service';

const mockSafeFetch = vi.fn();

vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
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
}));

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

const fakeCaptionedVideoBuffer = Buffer.from('fake-captioned-mp4-bytes');

function makeFfmpegProcess(exitCode = 0) {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  return {
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
      if (event === 'close') {
        setTimeout(() => cb(exitCode), 0);
      }
    }),
    _trigger: (event: string, ...args: any[]) => {
      (handlers[event] || []).forEach((cb) => cb(...args));
    },
  };
}

function makeWords(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    word: `word${i + 1}`,
    start: i * 0.1,
    end: (i + 1) * 0.1,
  }));
}

function makeService(wordCount: number) {
  const words = makeWords(wordCount);
  const defaultsResolution = {
    resolve: vi.fn().mockResolvedValue({
      providerId: 'deepgram',
      version: 'v1',
      model: 'nova-2',
      source: 'stored',
    }),
  };
  const aiMediaService = {
    speechToTextWords: vi.fn().mockResolvedValue({
      text: words.map((w) => w.word).join(' '),
      words,
    }),
  };
  const lifecycle = {
    createPendingJob: vi.fn().mockResolvedValue({
      id: 'caption-job-1',
      organizationId: 'org-1',
      operation: 'caption',
      provider: 'deepgram',
    }),
    completeJobWithBuffer: vi.fn().mockResolvedValue(true),
    getJob: vi.fn().mockResolvedValue({
      id: 'caption-job-1',
      artifactUrl: '/uploads/captioned.mp4',
      status: 'completed',
    }),
    failJob: vi.fn().mockResolvedValue(undefined),
  };
  const storage = {};
  const fileService = {
    getFileByPath: vi.fn().mockResolvedValue(null),
  };

  return {
    service: new CaptionService(
      defaultsResolution as never,
      aiMediaService as never,
      lifecycle as never,
      storage as never,
      fileService as never,
    ),
    mocks: { defaultsResolution, aiMediaService, lifecycle, fileService },
  };
}

describe('CaptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from('fake-source-mp4-bytes').buffer,
      headers: { get: () => 'video/mp4' },
    });
    mockMkdtempSync.mockReturnValue('/tmp/postmill-caption-xxx');
    mockReadFileSync.mockReturnValue(fakeCaptionedVideoBuffer);
    mockSpawn.mockImplementation(() => makeFfmpegProcess(0));
  });

  it('throws DefaultNotConfiguredError when no STT default is configured', async () => {
    const { service, mocks } = makeService(5);
    mocks.defaultsResolution.resolve.mockResolvedValue(null);

    await expect(
      service.captionVideo({ orgId: 'org-1', videoUrl: 'https://cdn.example.com/video.mp4' }),
    ).rejects.toThrow('No default configured for category: video-caption');
  });

  it('burns captions with segment grouping matching MAX_WORDS_PER_SEGMENT', async () => {
    const wordCount = MAX_WORDS_PER_SEGMENT + 1;
    const { service, mocks } = makeService(wordCount);

    const result = await service.captionVideo({
      orgId: 'org-1',
      videoUrl: 'https://cdn.example.com/video.mp4',
      style: 'srt',
    });

    expect(mocks.defaultsResolution.resolve).toHaveBeenCalledWith('media', 'video-caption', 'org-1');
    expect(mocks.lifecycle.createPendingJob).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        operation: 'caption',
        provider: 'deepgram',
        model: 'nova-2',
        version: 'v1',
      }),
    );

    expect(mocks.aiMediaService.speechToTextWords).toHaveBeenCalled();
    expect(mockSafeFetch).toHaveBeenCalledWith('https://cdn.example.com/video.mp4');

    expect(mocks.lifecycle.completeJobWithBuffer).toHaveBeenCalled();
    const completedBuffer = mocks.lifecycle.completeJobWithBuffer.mock.calls[0][1];
    expect(Buffer.isBuffer(completedBuffer)).toBe(true);
    expect(completedBuffer.toString()).toBe('fake-captioned-mp4-bytes');

    const completedMime = mocks.lifecycle.completeJobWithBuffer.mock.calls[0][2];
    expect(completedMime).toBe('video/mp4');

    const metadata = mocks.lifecycle.completeJobWithBuffer.mock.calls[0][3];
    expect(metadata.segments).toHaveLength(2);
    expect(metadata.segments[0].text.split(' ')).toHaveLength(MAX_WORDS_PER_SEGMENT);
    expect(metadata.segments[1].text.split(' ')).toHaveLength(1);

    expect(result).toBe('/uploads/captioned.mp4');
  });

  it('strips {, } override tokens and newlines from caption text before burn-in (6.4)', async () => {
    const { service, mocks } = makeService(1);
    mocks.aiMediaService.speechToTextWords.mockResolvedValue({
      text: 'x',
      // A crafted transcript word carrying an ASS override token + a newline.
      words: [{ word: 'hi{\\an8}\nthere.', start: 0, end: 1 }],
    });

    await service.captionVideo({
      orgId: 'org-1',
      videoUrl: 'https://cdn.example.com/video.mp4',
      style: 'ass',
    });

    const assWrite = mockWriteFileSync.mock.calls.find(([p]: any[]) =>
      String(p).endsWith('.ass'),
    );
    expect(assWrite).toBeDefined();
    const content = assWrite![1] as string;
    const dialogue = content
      .split('\n')
      .find((l) => l.startsWith('Dialogue:'));
    expect(dialogue).toBeDefined();
    // The override delimiters and injected newline are gone.
    expect(dialogue).not.toContain('{');
    expect(dialogue).not.toContain('}');
    expect(dialogue).toContain('an8');
    // The whole Events section is a single Dialogue line (no newline-split cue).
    const dialogueLines = content
      .split('\n')
      .filter((l) => l.startsWith('Dialogue:'));
    expect(dialogueLines).toHaveLength(1);
  });
});
