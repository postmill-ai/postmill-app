import { describe, it, expect, vi, beforeEach } from 'vitest';

const { GoogleAuthMock } = vi.hoisted(() => {
  const getAccessTokenMock = vi.fn().mockResolvedValue({ token: 'minted-token' });
  const getClientMock = vi.fn().mockResolvedValue({ getAccessToken: getAccessTokenMock });
  return { GoogleAuthMock: vi.fn(function () { return { getClient: getClientMock }; }) };
});

vi.mock('@ai-sdk/google-vertex', () => ({
  createVertex: vi.fn(() => ({
    languageModel: vi.fn(() => ({
      doGenerate: vi.fn().mockResolvedValue({}),
    })),
    imageModel: vi.fn(function() { return {}; }),
    textEmbeddingModel: vi.fn(function() { return {}; }),
  })),
}));

vi.mock('google-auth-library', () => ({
  GoogleAuth: GoogleAuthMock,
}));

import { VertexAdapter } from '../ai.adapter';
import { createVertex } from '@ai-sdk/google-vertex';

describe('VertexAdapter', () => {
  let adapter: VertexAdapter;

  const validCreds = {
    project: 'my-gcp-project',
    location: 'us-central1',
    googleCredentials: JSON.stringify({ type: 'service_account', project_id: 'test' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new VertexAdapter();
  });

  describe('metadata', () => {
    it('has identifier "vertex"', () => {
      expect(adapter.identifier).toBe('vertex');
    });

    it('has name "Google Vertex"', () => {
      expect(adapter.name).toBe('Google Vertex');
    });

    it('has type "hub"', () => {
      expect(adapter.type).toBe('hub');
    });

    it('has credentialFields for project, location, googleCredentials', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('project');
      expect(keys).toContain('location');
      expect(keys).toContain('googleCredentials');

      const projectField = adapter.credentialFields.find((f) => f.key === 'project');
      expect(projectField?.required).toBe(true);

      const locationField = adapter.credentialFields.find((f) => f.key === 'location');
      expect(locationField?.required).toBe(true);

      const credsField = adapter.credentialFields.find((f) => f.key === 'googleCredentials');
      expect(credsField?.required).toBe(true);
      expect(credsField?.type).toBe('textarea');
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
    it('returns Gemini, embedding, and image models', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      const gemini = models.find((m) => m.id === 'gemini-2.5-pro');
      expect(gemini).toBeDefined();
      expect(gemini?.kind).toBe('text');

      const embedding = models.find((m) => m.id === 'text-embedding-004');
      expect(embedding).toBeDefined();
      expect(embedding?.kind).toBe('embedding');

      const imagen = models.find((m) => m.id === 'imagen-3.0-generate-001');
      expect(imagen).toBeDefined();
      expect(imagen?.kind).toBe('image');
    });

    it('does not throw on empty credentials', async () => {
      const models = await adapter.listModels({});
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('validateCredentials', () => {
    it('returns error for missing project', async () => {
      const result = await adapter.validateCredentials({});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('GCP project ID is required');
    });

    it('returns error for missing location', async () => {
      const result = await adapter.validateCredentials({ project: 'my-project' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('GCP location is required');
    });

    it('returns error for missing googleCredentials', async () => {
      const result = await adapter.validateCredentials({ project: 'my-project', location: 'us-central1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('GCP service account JSON is required');
    });

    // 2.2: corrupt service-account JSON must NOT fall through to platform ADC.
    it('rejects corrupt googleCredentials JSON without minting a token (2.2)', async () => {
      const result = await adapter.validateCredentials({
        project: 'my-project',
        location: 'us-central1',
        googleCredentials: '{not valid json',
      });
      expect(result).toEqual({ ok: false, error: 'GCP service account JSON is not valid JSON' });
      // Never resolved any auth path (no ADC, no token mint).
      expect(GoogleAuthMock).not.toHaveBeenCalled();
    });

    // 5.15: valid creds validate via a cheap token mint, not a paid generation.
    it('validates via a token-mint probe, not a paid generation (5.15)', async () => {
      const result = await adapter.validateCredentials(validCreds);
      expect(result).toEqual({ ok: true });
      expect(GoogleAuthMock).toHaveBeenCalledWith(
        expect.objectContaining({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }),
      );
      // No inference SDK client built for validation.
      expect(createVertex).not.toHaveBeenCalled();
    });
  });

  // 2.2: the build path itself must throw on corrupt JSON (never resolve ADC).
  describe('_buildProvider (2.2)', () => {
    it('throws on corrupt googleCredentials instead of falling back to ADC', () => {
      expect(() =>
        adapter.createLanguageModel(
          { project: 'p', location: 'us-central1', googleCredentials: '{bad' },
          'gemini-2.5-flash',
        ),
      ).toThrow('Vertex AI service account JSON is not valid JSON');
    });
  });

  describe('createLanguageModel', () => {
    it('returns a language model', () => {
      const model = adapter.createLanguageModel(validCreds, 'gemini-2.5-flash');
      expect(model).toBeDefined();
    });
  });

  describe('createLangchainModel', () => {
    it('throws an error (not installed)', () => {
      expect(() =>
        adapter.createLangchainModel(validCreds, 'gemini-2.5-flash'),
      ).toThrow('Google Vertex AI LangChain integration is not installed');
    });
  });

  describe('createImageModel', () => {
    it('returns an image model', () => {
      const model = adapter.createImageModel(validCreds, 'imagen-3.0-generate-001');
      expect(model).toBeDefined();
    });
  });

  describe('createEmbeddingModel', () => {
    it('returns an embedding model', () => {
      const model = adapter.createEmbeddingModel(validCreds, 'text-embedding-004');
      expect(model).toBeDefined();
    });
  });
});
