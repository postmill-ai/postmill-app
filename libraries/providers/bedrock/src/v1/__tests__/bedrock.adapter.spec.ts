import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(() => ({
    languageModel: vi.fn(() => ({
      doGenerate: vi.fn().mockResolvedValue({}),
    })),
    imageModel: vi.fn(function() { return {}; }),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

import { BedrockAdapter } from '../ai.adapter';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

describe('BedrockAdapter', () => {
  let adapter: BedrockAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new BedrockAdapter();
  });

  describe('metadata', () => {
    it('has identifier "bedrock"', () => {
      expect(adapter.identifier).toBe('bedrock');
    });

    it('has name "Amazon Bedrock"', () => {
      expect(adapter.name).toBe('Amazon Bedrock');
    });

    it('has type "hub"', () => {
      expect(adapter.type).toBe('hub');
    });

    it('has credentialFields for region, accessKeyId, secretAccessKey, sessionToken', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('region');
      expect(keys).toContain('accessKeyId');
      expect(keys).toContain('secretAccessKey');
      expect(keys).toContain('sessionToken');

      const regionField = adapter.credentialFields.find((f) => f.key === 'region');
      expect(regionField?.required).toBe(true);

      const sessionField = adapter.credentialFields.find((f) => f.key === 'sessionToken');
      expect(sessionField?.required).toBe(false);
    });

    it('has capabilities (text, image, vision, embeddings, tools)', () => {
      expect(adapter.capabilities).toEqual({
        text: true,
        image: true,
        vision: true,
        embeddings: true,
        speech: false,
        tools: true,
      });
    });
  });

  describe('listModels', () => {
    it('returns Bedrock models including Claude, Nova, Titan', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const claude = models.find((m) => m.id === 'anthropic.claude-sonnet-4-20250514');
      expect(claude).toBeDefined();
      expect(claude?.kind).toBe('text');

      const nova = models.find((m) => m.id === 'amazon.nova-pro-v1:0');
      expect(nova).toBeDefined();

      const titan = models.find((m) => m.id === 'amazon.titan-embed-text-v2:0');
      expect(titan).toBeDefined();
      expect(titan?.kind).toBe('embedding');
      expect(titan?.dimension).toBe(1024);
    });

    it('does not throw on empty credentials', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('validateCredentials', () => {
    it('returns error for missing region', async () => {
      const result = await adapter.validateCredentials({});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('AWS region is required');
    });

    it('returns error for missing AWS credentials', async () => {
      const result = await adapter.validateCredentials({ region: 'us-east-1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('AWS credentials are required');
    });

    // 5.15: presence check only — never a paid `doGenerate` ping.
    it('validates present credentials without running paid inference (5.15)', async () => {
      const result = await adapter.validateCredentials({
        region: 'us-east-1',
        accessKeyId: 'AKIA-test',
        secretAccessKey: 'secret',
      });
      expect(result).toEqual({ ok: true });
      expect(createAmazonBedrock).not.toHaveBeenCalled();
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel(
        { region: 'us-east-1', accessKeyId: 'AKIA-test', secretAccessKey: 'secret' },
        'anthropic.claude-sonnet-4-20250514',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('throws an error (not installed)', () => {
      expect(() =>
        adapter.createLangchainModel(
          { region: 'us-east-1', accessKeyId: 'AKIA-test', secretAccessKey: 'secret' },
          'anthropic.claude-sonnet-4-20250514',
        ),
      ).toThrow('Amazon Bedrock LangChain integration is not installed');
    });
  });

  describe('createImageModel', () => {
    it('returns an image model', () => {
      const model = adapter.createImageModel(
        { region: 'us-east-1', accessKeyId: 'AKIA-test', secretAccessKey: 'secret' },
        'amazon.nova-pro-v1:0',
      );
      expect(model).toBeDefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns an embedding model', () => {
      const model = adapter.createEmbeddingModel(
        { region: 'us-east-1', accessKeyId: 'AKIA-test', secretAccessKey: 'secret' },
        'amazon.titan-embed-text-v2:0',
      );
      expect(model).toBeDefined();
    });
  });
});
