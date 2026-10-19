import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';

// The controller module imports the shared ioRedis client at load time; stub it so
// importing the controller never opens a real Redis connection.
vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: vi.fn(), set: vi.fn(), keys: vi.fn(), del: vi.fn() },
}));

import { HttpStatus } from '@nestjs/common';
import { MediaController } from './media.controller';
// Import from the SAME module the controller catches against so `instanceof` holds.
import { DefaultNotConfiguredError } from '@postmill-ai/nestjs-libraries/ai/defaults/ai-defaults.service';

const org = { id: 'org-1' } as any;

function build(defaultsOverride: Record<string, any> = {}) {
  const aiDefaults = {
    imageToImage: vi.fn().mockResolvedValue('https://cdn/out.png'),
    textToImage: vi.fn().mockResolvedValue('https://cdn/gen.png'),
    lowReasoningText: vi.fn().mockResolvedValue('a vivid cat'),
    videoUpscale: vi.fn().mockResolvedValue('job-up'),
    videoBackground: vi.fn().mockResolvedValue('job-bg'),
    videoToVideo: vi.fn().mockResolvedValue('job-v2v'),
    textToMusic: vi.fn().mockResolvedValue('job-music'),
    videoAvatar: vi.fn().mockResolvedValue('job-avatar'),
    imageSlide: vi.fn().mockResolvedValue('https://cdn/slide.mp4'),
    ...defaultsOverride,
  };
  const aiMediaService = {
    urlToBase64Image: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
    outpaintImage: vi.fn().mockResolvedValue('https://cdn/expanded.png'),
    saveUrlToFile: vi.fn().mockResolvedValue({
      id: 'file-1',
      path: 'http://localhost/uploads/file-1.png',
      name: 'generated-123.png',
    }),
  };
  const controller = new MediaController(
    aiDefaults as any,
    aiMediaService as any,
    {} as any, // _defaultsResolution
    {} as any, // _fileService
    {} as any, // _storageService
    {} as any, // _stockMediaService
    {} as any // _brandsService
  );
  return { controller, aiDefaults, aiMediaService };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('MediaController — Designer AI-media routes', () => {
  describe('transform family', () => {
    it('image-to-image delegates (org, prompt, imageUrl) and returns { url }', async () => {
      const { controller, aiDefaults } = build();
      const res = await controller.imageToImage(org, { imageUrl: 'https://x/a.png', prompt: 'make it blue' } as any);
      expect(aiDefaults.imageToImage).toHaveBeenCalledWith('org-1', 'make it blue', 'https://x/a.png');
      expect(res).toEqual({ url: 'https://cdn/out.png' });
    });

    it('upscale-video delegates (org, videoUrl) and returns { id, status:pending }', async () => {
      const { controller, aiDefaults } = build();
      const res = await controller.upscaleVideo(org, { videoUrl: 'https://x/v.mp4' } as any);
      expect(aiDefaults.videoUpscale).toHaveBeenCalledWith('org-1', 'https://x/v.mp4');
      expect(res).toEqual({ id: 'job-up', status: 'pending' });
    });

    it('remove-video-background delegates (org, videoUrl) and returns { id, status:pending }', async () => {
      const { controller, aiDefaults } = build();
      const res = await controller.removeVideoBackground(org, { videoUrl: 'https://x/v.mp4' } as any);
      expect(aiDefaults.videoBackground).toHaveBeenCalledWith('org-1', 'https://x/v.mp4');
      expect(res).toEqual({ id: 'job-bg', status: 'pending' });
    });

    it('video-to-video delegates (org, prompt, videoUrl) and returns { id, status:pending }', async () => {
      const { controller, aiDefaults } = build();
      const res = await controller.videoToVideo(org, { videoUrl: 'https://x/v.mp4', prompt: 'noir' } as any);
      expect(aiDefaults.videoToVideo).toHaveBeenCalledWith('org-1', 'noir', 'https://x/v.mp4');
      expect(res).toEqual({ id: 'job-v2v', status: 'pending' });
    });

    it('maps DefaultNotConfiguredError to HTTP 409 CONFLICT', async () => {
      const { controller } = build({
        videoUpscale: vi.fn().mockRejectedValue(new DefaultNotConfiguredError('video-upscale')),
      });
      await expect(
        controller.upscaleVideo(org, { videoUrl: 'https://x/v.mp4' } as any)
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    });
  });

  describe('generative family', () => {
    it('generate-music delegates (org, prompt) and returns { id, status:pending }', async () => {
      const { controller, aiDefaults } = build();
      const res = await controller.generateMusic(org, { prompt: 'lofi beat' } as any);
      expect(aiDefaults.textToMusic).toHaveBeenCalledWith('org-1', 'lofi beat');
      expect(res).toEqual({ id: 'job-music', status: 'pending' });
    });

    it('generate-avatar delegates (org, script, { imageUrl }) and returns { id, status:pending }', async () => {
      const { controller, aiDefaults } = build();
      const res = await controller.generateAvatar(org, { script: 'hi there', imageUrl: 'https://x/p.png' } as any);
      expect(aiDefaults.videoAvatar).toHaveBeenCalledWith('org-1', 'hi there', { imageUrl: 'https://x/p.png' });
      expect(res).toEqual({ id: 'job-avatar', status: 'pending' });
    });

    it('generate-slide delegates (org, prompt, imageUrls) and returns { id, status:pending }', async () => {
      const { controller, aiDefaults } = build();
      const res = await controller.generateSlide(org, { prompt: 'trip', imageUrls: ['https://x/1.png'] } as any);
      expect(aiDefaults.imageSlide).toHaveBeenCalledWith('org-1', 'trip', ['https://x/1.png']);
      expect(res).toEqual({ id: 'https://cdn/slide.mp4', status: 'pending' });
    });

    it('maps DefaultNotConfiguredError to HTTP 409 CONFLICT', async () => {
      const { controller } = build({
        imageSlide: vi.fn().mockRejectedValue(new DefaultNotConfiguredError('image-slide')),
      });
      await expect(
        controller.generateSlide(org, { prompt: 'x' } as any)
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    });

    it('outpaint delegates (imageUrl, mode, prompt, { orgId }) and returns { url }', async () => {
      const { controller, aiMediaService } = build();
      const res = await controller.outpaint(org, {
        imageUrl: 'https://x/a.png',
        mode: 'zoom-2x',
        prompt: 'more sky',
      } as any);
      expect(aiMediaService.outpaintImage).toHaveBeenCalledWith(
        'https://x/a.png',
        'zoom-2x',
        'more sky',
        { orgId: 'org-1' }
      );
      expect(res).toEqual({ url: 'https://cdn/expanded.png' });
    });

    it('generate-image returns { output: <base64 dataUrl> }', async () => {
      const { controller, aiDefaults, aiMediaService } = build();

      const res = await controller.generateImage(org, { body: {} } as any, 'a cat');

      expect(aiDefaults.textToImage).toHaveBeenCalledWith('org-1', 'a cat');
      expect(aiMediaService.urlToBase64Image).toHaveBeenCalledWith('https://cdn/gen.png');
      expect(res).toEqual({ output: 'data:image/png;base64,abc' });
    });

    it('generate-image-with-prompt persists and returns { id, path, name }', async () => {
      const { controller, aiMediaService } = build();

      const res = await controller.generateImageFromText(org, { body: {} } as any, 'a cat');

      expect(aiMediaService.saveUrlToFile).toHaveBeenCalledWith(
        'org-1',
        'data:image/png;base64,abc',
        'generated'
      );
      expect(res).toEqual({
        id: 'file-1',
        path: 'http://localhost/uploads/file-1.png',
        name: 'generated-123.png',
      });
    });

    it('rewrites a terse prompt but keeps the original request alongside', async () => {
      const { controller, aiDefaults } = build();

      await controller.generateImageFromText(org, { body: {} } as any, 'a cat');

      expect(aiDefaults.lowReasoningText).toHaveBeenCalled();
      expect(aiDefaults.textToImage).toHaveBeenCalledWith(
        'org-1',
        'a vivid cat\nOriginal request: a cat'
      );
    });

    it('skips the rewrite when the prompt is already detailed', async () => {
      const detailed =
        'A ginger cat wearing a tiny knitted sweater, sitting on a windowsill in warm evening light, shallow depth of field, photorealistic, 85mm lens';
      const { controller, aiDefaults } = build();

      await controller.generateImageFromText(org, { body: {} } as any, detailed);

      expect(aiDefaults.lowReasoningText).not.toHaveBeenCalled();
      expect(aiDefaults.textToImage).toHaveBeenCalledWith('org-1', detailed);
    });

    it('falls back to the original prompt when the rewrite fails', async () => {
      const { controller, aiDefaults } = build({
        lowReasoningText: vi.fn().mockRejectedValue(new DefaultNotConfiguredError('low-reasoning')),
      });

      const res = await controller.generateImageFromText(org, { body: {} } as any, 'a cat');

      expect(aiDefaults.textToImage).toHaveBeenCalledWith('org-1', 'a cat');
      expect(res).toEqual(
        expect.objectContaining({ id: 'file-1', name: 'generated-123.png' })
      );
    });
  });
});
