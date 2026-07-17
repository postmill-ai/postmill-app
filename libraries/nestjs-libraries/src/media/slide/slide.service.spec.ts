import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlideService } from './slide.service';

const mockSafeFetch = vi.fn();

vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
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
      if (category === 'text-to-speech') {
        return Promise.resolve({
          providerId: 'elevenlabs',
          version: 'v1',
          model: 'eleven_multilingual_v2',
          source: 'stored',
        });
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
    service: new SlideService(defaultsResolution as never, aiDefaults as never, lifecycle as never),
    mocks: { defaultsResolution, aiDefaults, lifecycle },
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

  it('creates an AIMediaJob with operation slide that completes to a /files video artifact', async () => {
    const { service, mocks } = makeService();

    const result = await service.generateSlide({ orgId: 'org-1', prompt: 'A friendly greeting' });

    expect(mocks.defaultsResolution.resolve).toHaveBeenCalledWith('media', 'image-slide', 'org-1');
    expect(mocks.defaultsResolution.resolve).toHaveBeenCalledWith('media', 'text-to-speech', 'org-1');
    expect(mocks.defaultsResolution.resolve).toHaveBeenCalledWith('ai', 'high-reasoning', 'org-1');

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
    expect(mocks.aiDefaults.textToSpeech).toHaveBeenCalledWith('org-1', 'Hello world');

    expect(mockSafeFetch).toHaveBeenCalledWith('https://cdn.example.com/slide.png');
    expect(mocks.lifecycle.completeJobWithBuffer).toHaveBeenCalled();

    const completedBuffer = mocks.lifecycle.completeJobWithBuffer.mock.calls[0][1];
    expect(Buffer.isBuffer(completedBuffer)).toBe(true);
    expect(completedBuffer.toString()).toBe('fake-mp4-bytes');

    const completedMime = mocks.lifecycle.completeJobWithBuffer.mock.calls[0][2];
    expect(completedMime).toBe('video/mp4');

    expect(result).toBe('/uploads/slide-output.mp4');
  });
});
