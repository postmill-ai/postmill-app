import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setAiRegistry,
  testConnectionViaAiSdk,
  listImageModelsViaAiSdk,
  generateImageViaAiSdk,
} from '../domains/media-helpers';

describe('media-helpers — AI-SDK bridge', () => {
  beforeEach(() => {
    setAiRegistry(undefined as any);
  });

  describe('testConnectionViaAiSdk', () => {
    it('returns ok when credentials validate', async () => {
      setAiRegistry({
        getAdapter: () =>
          ({
            validateCredentials: vi.fn().mockResolvedValue({ ok: true }),
          }) as any,
      });
      const res = await testConnectionViaAiSdk('bedrock', { key: 'k' });
      expect(res.ok).toBe(true);
      expect(res.message).toBe('Connection successful');
    });

    it('returns the adapter error when validation fails', async () => {
      setAiRegistry({
        getAdapter: () =>
          ({
            validateCredentials: vi.fn().mockResolvedValue({
              ok: false,
              error: 'bad key',
            }),
          }) as any,
      });
      const res = await testConnectionViaAiSdk('bedrock', { key: 'k' });
      expect(res.ok).toBe(false);
      expect(res.message).toBe('bad key');
    });

    it('returns unknown-provider when the adapter is missing', async () => {
      setAiRegistry({ getAdapter: () => undefined });
      const res = await testConnectionViaAiSdk('missing', {});
      expect(res.ok).toBe(false);
      expect(res.message).toContain('Unknown provider');
    });
  });

  describe('listImageModelsViaAiSdk', () => {
    it('filters and labels image models', async () => {
      setAiRegistry({
        getAdapter: () =>
          ({
            listModels: vi.fn().mockResolvedValue([
              { id: 'img-1', label: 'Image One', kind: 'image' },
              { id: 'txt-1', label: 'Text One', kind: 'text' },
              { id: 'img-2', capabilities: { image: true } },
            ]),
          }) as any,
      });
      const models = await listImageModelsViaAiSdk('azure', {});
      expect(models).toEqual([
        { id: 'img-1', label: 'Image One' },
        { id: 'img-2', label: 'img-2' },
      ]);
    });

    it('returns an empty array when the adapter is missing', async () => {
      setAiRegistry({ getAdapter: () => undefined });
      const models = await listImageModelsViaAiSdk('missing', {});
      expect(models).toEqual([]);
    });
  });

  describe('generateImageViaAiSdk', () => {
    it('returns data URLs for base64 images', async () => {
      setAiRegistry({
        getAdapter: () =>
          ({
            createImageModel: vi.fn().mockReturnValue({
              doGenerate: vi.fn().mockResolvedValue({
                images: ['iVBORw0KGgo='],
              }),
            }),
          }) as any,
      });
      const result = await generateImageViaAiSdk({
        identifier: 'azure',
        credentials: { key: 'k' },
        prompt: 'a cat',
        model: 'dall-e-3',
      });
      expect(result.image).toMatch(/^data:image\/png;base64,/);
      expect(result.images).toHaveLength(1);
    });

    it('throws when the adapter lacks image support', async () => {
      setAiRegistry({
        getAdapter: () => ({ createImageModel: undefined }) as any,
      });
      await expect(
        generateImageViaAiSdk({
          identifier: 'azure',
          credentials: {},
          prompt: 'a cat',
          model: 'x',
        }),
      ).rejects.toThrow('does not support image generation');
    });
  });
});
