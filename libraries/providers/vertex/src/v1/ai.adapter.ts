import { createVertex } from '@ai-sdk/google-vertex';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LanguageModelV2, ImageModelV2, EmbeddingModelV2 } from '@ai-sdk/provider-v5';
import { GoogleAuth, type GoogleAuthOptions } from 'google-auth-library';
import { metadata as providerMetadata } from './metadata';
import {
  type AiCapability as AIProviderAdapter,
  type AiCredentialField as CredentialField,
  type AiModelInfo as ModelInfo,
  type AiCapabilities as AICapabilities,
  type AiModelOptions as AIModelOptions,
  type ProviderModule,
} from '@gitroom/provider-kernel';

const VERTEX_CAPABILITIES: AICapabilities = {
  text: true,
  image: true,
  vision: true,
  embeddings: true,
  speech: false,
  tools: true,
};

const VERTEX_CREDENTIAL_FIELDS: CredentialField[] = [
  { key: 'project', label: 'GCP Project ID', type: 'string', required: true, placeholder: 'my-gcp-project' },
  { key: 'location', label: 'GCP Location', type: 'string', required: true, placeholder: 'us-central1' },
  { key: 'googleCredentials', label: 'GCP Service Account JSON', type: 'textarea', required: true, placeholder: 'Paste your service account key JSON' },
];

const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const VERTEX_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', kind: 'text', capabilities: { ...VERTEX_CAPABILITIES, embeddings: false }, reasoning: true },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', kind: 'text', capabilities: { ...VERTEX_CAPABILITIES, embeddings: false } },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', kind: 'text', capabilities: { ...VERTEX_CAPABILITIES, embeddings: false } },
  { id: 'text-embedding-004', label: 'Text Embedding 004', kind: 'embedding', dimension: 768, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'text-embedding-005', label: 'Text Embedding 005', kind: 'embedding', dimension: 768, capabilities: { text: false, image: false, vision: false, embeddings: true, speech: false, tools: false } },
  { id: 'imagen-3.0-generate-001', label: 'Imagen 3.0', kind: 'image', capabilities: { text: false, image: true, vision: false, embeddings: false, speech: false, tools: false } },
];

export class VertexAdapter implements AIProviderAdapter {
  readonly identifier = 'vertex';
  readonly name = 'Google Vertex';
  // Hub: Google cloud aggregator fronting Gemini + Anthropic + Llama + others.
  readonly type = 'hub' as const;
  readonly credentialFields = VERTEX_CREDENTIAL_FIELDS;
  readonly capabilities = VERTEX_CAPABILITIES;
  readonly privacy = {
    dataRetention: 'Data processed in your GCP project — governed by your GCP data policy',
    trainingOnData: false,
    description: 'Google Vertex AI — enterprise Gemini and Imagen models via GCP',
  };

  private _buildProvider(creds: Record<string, string>) {
    let googleAuthOptions: GoogleAuthOptions | undefined;
    if (creds.googleCredentials) {
      // 2.2: THROW on unparseable service-account JSON. Previously this fell
      // through to `googleAuthOptions: undefined`, which resolves platform
      // Application Default Credentials — a tenant with corrupt JSON would then
      // run inference on the deployment's GCP identity/billing. Mirrors the
      // media twin (media.adapter.ts).
      let parsed: object;
      try {
        parsed = JSON.parse(creds.googleCredentials);
      } catch {
        throw new Error('Vertex AI service account JSON is not valid JSON');
      }
      googleAuthOptions = { credentials: parsed };
    }
    return createVertex({
      project: creds.project,
      location: creds.location,
      googleAuthOptions,
    });
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return VERTEX_MODELS;
  }

  async validateCredentials(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!creds.project) return { ok: false, error: 'GCP project ID is required' };
    if (!creds.location) return { ok: false, error: 'GCP location is required' };
    if (!creds.googleCredentials) return { ok: false, error: 'GCP service account JSON is required' };
    // 2.2: reject corrupt JSON before touching any auth path (never resolve ADC).
    let parsed: object;
    try {
      parsed = JSON.parse(creds.googleCredentials);
    } catch {
      return { ok: false, error: 'GCP service account JSON is not valid JSON' };
    }
    // 5.15: cheap authenticated token-mint probe instead of a paid generation.
    // Minting an access token from the service-account JSON verifies the
    // credentials without running (billable) inference. Mirrors the media twin.
    try {
      const auth = new GoogleAuth({ credentials: parsed, scopes: [VERTEX_SCOPE] });
      const client = await auth.getClient();
      const token = (await client.getAccessToken()).token;
      if (!token) return { ok: false, error: 'Could not mint an access token from the service account' };
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Unknown error' };
    }
  }

  /** @note vertex SDK returns specificationVersion "v1" — cast through unknown to satisfy the v2 interface */
  createLanguageModel(creds: Record<string, string>, modelId: string, _opts?: AIModelOptions): LanguageModelV2 {
    return this._buildProvider(creds).languageModel(modelId) as unknown as LanguageModelV2;
  }

  createLangchainModel(_creds: Record<string, string>, _modelId: string, _opts?: AIModelOptions): BaseChatModel {
    throw new Error('Google Vertex AI LangChain integration is not installed. Use languageModel() instead.');
  }

  /** @note vertex SDK returns specificationVersion "v1" */
  createImageModel(creds: Record<string, string>, modelId: string): ImageModelV2 | undefined {
    return this._buildProvider(creds).imageModel?.(modelId) as unknown as ImageModelV2 | undefined;
  }

  /** @note vertex SDK returns specificationVersion "v1" */
  createEmbeddingModel(creds: Record<string, string>, modelId: string): EmbeddingModelV2<string> | undefined {
    return this._buildProvider(creds).textEmbeddingModel?.(modelId) as unknown as EmbeddingModelV2<string> | undefined;
  }
}

const adapter = new VertexAdapter();

export const vertexAiModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'ai',
    providerId: adapter.identifier,
    version: 'v1',
    displayName: adapter.name,
    status: 'active',
    credentialFields: (adapter as any).credentialFields || [],
    capabilities: (adapter as any).capabilities,
  },
  create: () => adapter as any,
  validateCredentials: async (ctx) => adapter.validateCredentials(ctx.credentials),
};
