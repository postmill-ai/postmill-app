import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlideService } from './slide.service';

const mockSafeFetch = vi.fn();

vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (...args: any[]) => mockSafeFetch(...args),
}));

const mockSpawn = vi.fn();
const mockMkdtempSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockRmSync = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(true);

vi.mock('fs', () => ({
  mkdtempSync: (...args: any[]) => mockMkdtempSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  rmSync: (...args: any[]) => mockRmSync(...args),
  existsSync: (...args: any[]) => mockExistsSync(...args),
}));

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

const mockParseFile = vi.fn();

vi.mock('music-metadata', () => ({
  parseFile: (...args: any[]) => mockParseFile(...args),
}));

const fakeVideoBuffer = Buffer.from('fake-mp4-bytes');

function makeFfmpegProcess(exitCode = 0, stderr = '') {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  return {
    stderr: {
      on: vi.fn().mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data' && stderr) {
          setTimeout(() => cb(Buffer.from(stderr)), 0);
        }
      }),
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

function makeService() {
  const defaultsResolution = {
    resolve: vi.fn().mockImplementation((_domain: string, category: string) => {
      if (category === 'image-slide') {
        return Promise.resolve({ providerId: 'openai', version: 'v1', model: 'dall-e-3', source: 'stored' });
      }
      if (category === 'high-reasoning') {
        return Promise.resolve({ providerId: 'openai', version: 'v1', model: 'o3-mini', source: 'stored' });
      }
      return Promise.resolve(null);
    }),
  };
  const aiDefaults = {
    highReasoningText: vi.fn().mockResolvedValue(
      JSON.stringify([{ script: 'Hello world', imagePrompt: 'A friendly greeting' }]),
    ),
    textToImage: vi.fn().mockResolvedValue('https://cdn.example.com/slide.png'),
  };
  // The TTS leg resolves through the SAME capability machinery as
  // POST /media/text-to-speech (listGenerationProviders → _resolveForOperation),
  // not the defaults-catalog resolver.
  const aiMediaService = {
    listGenerationProviders: vi.fn().mockResolvedValue({
      providers: [{ identifier: 'openai', name: 'OpenAI' }],
      default: { providerId: 'openai', model: 'gpt-4o-mini-tts' },
    }),
    textToSpeech: vi.fn().mockResolvedValue(Buffer.from('fake-mp3-bytes')),
  };
  const lifecycle = {
    createPendingJob: vi.fn().mockResolvedValue({
      id: 'slide-job-1',
      organizationId: 'org-1',
      operation: 'slide',
      provider: 'openai',
    }),
    completeJobWithBuffer: vi.fn().mockResolvedValue(true),
    getJob: vi.fn().mockResolvedValue({
      id: 'slide-job-1',
      artifactUrl: '/uploads/slide-output.mp4',
      status: 'completed',
    }),
    failJob: vi.fn().mockResolvedValue(undefined),
  };

  return {
    service: new SlideService(defaultsResolution as never, aiDefaults as never, aiMediaService as never, lifecycle as never),
    mocks: { defaultsResolution, aiDefaults, aiMediaService, lifecycle },
  };
}

describe('SlideService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from('fake-png-bytes').buffer,
    });
    mockMkdtempSync.mockReturnValue('/tmp/postmill-slide-xxx');
    mockReadFileSync.mockReturnValue(fakeVideoBuffer);
    mockParseFile.mockResolvedValue({ format: { duration: 1.2 } });
    mockSpawn.mockImplementation(() => makeFfmpegProcess(0));
  });

  it('throws DefaultNotConfiguredError when a sub-default is missing', async () => {
    const { service, mocks } = makeService();
    mocks.defaultsResolution.resolve.mockResolvedValue(null);

    await expect(service.generateSlide({ orgId: 'org-1', prompt: 'Test' })).rejects.toThrow(
      'No default configured for category: image-slide',
    );
  });

  it('generates when only the endpoint-style TTS resolution finds a provider (the prod 409 path)', async () => {
    // Postmill QA prod case: the org's OpenAI TTS default works via
    // /media/text-to-speech (capability-driven resolution) even where the
    // defaults-catalog read for 'text-to-speech' resolves nothing. The slide
    // pipeline must not 409 in that state.
    const { service, mocks } = makeService();
    mocks.defaultsResolution.resolve.mockImplementation((_domain: string, category: string) => {
      if (category === 'text-to-speech') return Promise.resolve(null);
      if (category === 'image-slide') {
        return Promise.resolve({ providerId: 'openai', version: 'v1', model: 'dall-e-3', source: 'stored' });
      }
      if (category === 'high-reasoning') {
        return Promise.resolve({ providerId: 'openai', version: 'v1', model: 'o3-mini', source: 'stored' });
      }
      return Promise.resolve(null);
    });
    mocks.aiMediaService.listGenerationProviders.mockResolvedValue({
      providers: [{ identifier: 'openai', name: 'OpenAI' }],
      default: { providerId: 'openai', model: 'gpt-4o-mini-tts' },
    });

    const result = await service.generateSlide({ orgId: 'org-1', prompt: 'A friendly greeting' });

    expect(result).toBe('/uploads/slide-output.mp4');
    expect(mocks.aiMediaService.textToSpeech).toHaveBeenCalledWith('Hello world', { orgId: 'org-1' });
  });

  it('throws DefaultNotConfiguredError when no TTS-capable provider resolves', async () => {
    const { service, mocks } = makeService();
    mocks.aiMediaService.listGenerationProviders.mockResolvedValue({ providers: [], default: null });

    await expect(service.generateSlide({ orgId: 'org-1', prompt: 'Test' })).rejects.toThrow(
      'No default configured for category: text-to-speech',
    );
    expect(mocks.lifecycle.createPendingJob).not.toHaveBeenCalled();
  });

  it('creates an AIMediaJob with operation slide that completes to a /files video artifact', async () => {
    const { service, mocks } = makeService();

    const result = await service.generateSlide({ orgId: 'org-1', prompt: 'A friendly greeting' });

    expect(mocks.defaultsResolution.resolve).toHaveBeenCalledWith('media', 'image-slide', 'org-1');
    expect(mocks.defaultsResolution.resolve).toHaveBeenCalledWith('ai', 'high-reasoning', 'org-1');
    // The TTS gate is the endpoint's capability resolution, not the defaults catalog.
    expect(mocks.aiMediaService.listGenerationProviders).toHaveBeenCalledWith('org-1', 'tts');
    expect(mocks.defaultsResolution.resolve).not.toHaveBeenCalledWith('media', 'text-to-speech', 'org-1');

    expect(mocks.lifecycle.createPendingJob).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        operation: 'slide',
        provider: 'openai',
        model: 'dall-e-3',
        version: 'v1',
      }),
    );

    expect(mocks.aiDefaults.highReasoningText).toHaveBeenCalled();
    expect(mocks.aiDefaults.textToImage).toHaveBeenCalledWith('org-1', 'A friendly greeting');
    expect(mocks.aiMediaService.textToSpeech).toHaveBeenCalledWith('Hello world', { orgId: 'org-1' });

    expect(mockSafeFetch).toHaveBeenCalledWith('https://cdn.example.com/slide.png');
    expect(mocks.lifecycle.completeJobWithBuffer).toHaveBeenCalled();

    const completedBuffer = mocks.lifecycle.completeJobWithBuffer.mock.calls[0][1];
    expect(Buffer.isBuffer(completedBuffer)).toBe(true);
    expect(completedBuffer.toString()).toBe('fake-mp4-bytes');

    const completedMime = mocks.lifecycle.completeJobWithBuffer.mock.calls[0][2];
    expect(completedMime).toBe('video/mp4');

    expect(result).toBe('/uploads/slide-output.mp4');
  });

  it('decodes a data: URI image artifact locally instead of fetching it', async () => {
    const { service, mocks } = makeService();
    // OpenRouter returns the generated image inline — safeFetch (http/https
    // only) blocked these and the whole slide job 500'd with "Blocked URL".
    mocks.aiDefaults.textToImage.mockResolvedValue(
      `data:image/png;base64,${Buffer.from('inline-png-bytes').toString('base64')}`,
    );

    const result = await service.generateSlide({ orgId: 'org-1', prompt: 'A friendly greeting' });

    expect(mockSafeFetch).not.toHaveBeenCalled();
    // The first writeFileSync after the audio write is the decoded image…
    const imageWrite = mockWriteFileSync.mock.calls.find(
      (call) => Buffer.isBuffer(call[1]) && call[1].toString() === 'inline-png-bytes',
    );
    expect(imageWrite).toBeTruthy();
    expect(result).toBe('/uploads/slide-output.mp4');
  });

  it('buckets the target canvas into an aspect for the image provider and normalizes each frame (cover by default)', async () => {
    const { service, mocks } = makeService();

    const result = await service.generateSlide({
      orgId: 'org-1',
      prompt: 'A friendly greeting',
      targetWidth: 1920,
      targetHeight: 1080,
    });

    expect(result).toBe('/uploads/slide-output.mp4');
    expect(mocks.aiDefaults.textToImage).toHaveBeenCalledWith('org-1', 'A friendly greeting', { aspect: 'wide' });

    // A per-slide normalization ffmpeg pass ran BEFORE the concat encode, with
    // the cover filter (scale-to-fill + crop) for the requested canvas.
    const normCall = mockSpawn.mock.calls.find((call) =>
      (call[1] as string[]).some((a) => typeof a === 'string' && a.includes('force_original_aspect_ratio')),
    );
    expect(normCall).toBeTruthy();
    const normArgs = normCall![1] as string[];
    expect(normArgs).toContain('scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1');
    expect(normArgs[normArgs.length - 1]).toBe('/tmp/postmill-slide-xxx/slide-0.norm.png');

    // The concat demuxer consumes the normalized frame, not the raw download.
    const concatWrite = mockWriteFileSync.mock.calls.find((call) => String(call[0]).endsWith('concat.txt'));
    expect(String(concatWrite![1])).toContain('slide-0.norm.png');
  });

  it('honors an explicit aspect and contain fitMode', async () => {
    const { service, mocks } = makeService();

    await service.generateSlide({
      orgId: 'org-1',
      prompt: 'A friendly greeting',
      aspect: 'square',
      targetWidth: 1080,
      targetHeight: 1920,
      fitMode: 'contain',
    });

    // Explicit aspect wins over the bucket the canvas dims would give ('tall').
    expect(mocks.aiDefaults.textToImage).toHaveBeenCalledWith('org-1', 'A friendly greeting', { aspect: 'square' });

    const normCall = mockSpawn.mock.calls.find((call) =>
      (call[1] as string[]).some((a) => typeof a === 'string' && a.includes('force_original_aspect_ratio')),
    );
    expect(normCall).toBeTruthy();
    expect(normCall![1]).toContain(
      'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1',
    );
  });

  it('keeps the legacy path when no target canvas is supplied (no aspect opt, no normalization pass)', async () => {
    const { service, mocks } = makeService();

    await service.generateSlide({ orgId: 'org-1', prompt: 'A friendly greeting' });

    expect(mocks.aiDefaults.textToImage).toHaveBeenCalledWith('org-1', 'A friendly greeting');
    const normCall = mockSpawn.mock.calls.find((call) =>
      (call[1] as string[]).some((a) => typeof a === 'string' && a.includes('force_original_aspect_ratio')),
    );
    expect(normCall).toBeUndefined();
    const concatWrite = mockWriteFileSync.mock.calls.find((call) => String(call[0]).endsWith('concat.txt'));
    expect(String(concatWrite![1])).toContain('slide-0.jpg');
  });
});
