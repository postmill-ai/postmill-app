# Adding an AI Provider Adapter

Postmill's AI layer supports 25 providers through a pluggable adapter system. Each adapter lives in its own workspace package under `libraries/providers/<id>/` and is registered into the `ProviderKernel` at backend boot.

> Verified against v1.0.0

---

## Decision: bespoke vs OpenAI-compatible

Before writing code, decide which pattern applies:

| Pattern | When to use | Example |
|---------|------------|---------|
| **Bespoke adapter** | Provider has its own `@ai-sdk/*` package (e.g. `@ai-sdk/anthropic`, `@ai-sdk/google`) | OpenAI, Anthropic, Google, xAI, Mistral |
| **OpenAICompatibleAdapter** | Provider exposes an OpenAI-compatible API endpoint | SiliconFlow, DeepInfra, MiniMax, Qwen |

For OpenAI-compatible providers, instantiate `OpenAICompatibleAdapter` from `@gitroom/provider-kernel` with a base URL and capabilities. No bespoke class is needed.

For bespoke providers, create a class implementing `AiCapability` from `@gitroom/provider-kernel`.

---

## Step 1: Create the provider package

Add a workspace package at `libraries/providers/<id>/`. At minimum it needs:

```
libraries/providers/<id>/
├── package.json
├── src/
│   ├── index.ts
│   └── v1/
│       ├── index.ts
│       ├── ai.adapter.ts
│       └── metadata.ts
```

`package.json` example:

```json
{
  "name": "@gitroom/provider-yourprovider",
  "version": "1.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "@gitroom/provider-kernel": "workspace:*"
  }
}
```

Add the package to `pnpm-workspace.yaml` if it is not already covered by the existing glob.

---

## Step 2: Implement the adapter

Create `libraries/providers/<id>/src/v1/ai.adapter.ts`.

### Bespoke adapter

```typescript
import { createYourProvider } from '@ai-sdk/yourprovider';
import { ChatYourProvider } from '@langchain/yourprovider';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  LanguageModelV2,
  ImageModelV2,
  EmbeddingModelV2,
  SpeechModelV2,
} from '@ai-sdk/provider-v5';
import {
  type AiCapability as AIProviderAdapter,
  type AiCredentialField as CredentialField,
  type AiModelInfo as ModelInfo,
  type AiCapabilities as AICapabilities,
  type AiModelOptions as AIModelOptions,
  type ProviderModule,
  type SafeFetchPort,
} from '@gitroom/provider-kernel';
import { metadata as providerMetadata } from './metadata';

const CAPABILITIES: AICapabilities = {
  text: true,
  image: false,
  vision: false,
  embeddings: false,
  speech: false,
  tools: true,
};

const CREDENTIAL_FIELDS: CredentialField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'password',
    required: true,
    placeholder: 'Enter your API key',
  },
];

export class YourProviderAdapter implements AIProviderAdapter {
  readonly identifier = 'yourprovider';
  readonly name = 'Your Provider';
  readonly type = 'direct' as const;
  readonly credentialFields = CREDENTIAL_FIELDS;
  readonly capabilities = CAPABILITIES;

  private _safeFetch?: SafeFetchPort;

  setSafeFetch(fetch: SafeFetchPort): void {
    this._safeFetch = fetch;
  }

  async listModels(_creds: Record<string, string>): Promise<ModelInfo[]> {
    return [
      {
        id: 'model-v1',
        label: 'Model V1',
        kind: 'text',
        capabilities: this.capabilities,
      },
    ];
  }

  async validateCredentials(
    creds: Record<string, string>,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!creds.apiKey) {
      return { ok: false, error: 'API key is required' };
    }
    if (!this._safeFetch) {
      return { ok: false, error: 'cannot validate' };
    }
    try {
      const response = await this._safeFetch('https://api.yourprovider.com/v1/models', {
        headers: { Authorization: `Bearer ${creds.apiKey}` },
      });
      if (response.ok) return { ok: true };
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'Invalid API key' };
      }
      return { ok: false, error: `Unexpected response: ${response.status}` };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  createLanguageModel(
    creds: Record<string, string>,
    modelId: string,
    _opts?: AIModelOptions,
  ): LanguageModelV2 {
    const provider = createYourProvider({ apiKey: creds.apiKey });
    return provider.languageModel(modelId);
  }

  createLangchainModel(
    creds: Record<string, string>,
    modelId: string,
    opts?: AIModelOptions,
  ): BaseChatModel {
    return new ChatYourProvider({
      apiKey: creds.apiKey,
      model: modelId,
      temperature: opts?.temperature,
      topP: opts?.topP,
      maxTokens: opts?.maxTokens,
    });
  }
}

const adapter = new YourProviderAdapter();

export const yourproviderAiModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'ai',
    providerId: adapter.identifier,
    version: 'v1',
    displayName: adapter.name,
    status: 'active',
    credentialFields: adapter.credentialFields,
    capabilities: adapter.capabilities,
  },
  create: (ctx) => {
    adapter.setSafeFetch(ctx.fetch);
    return adapter as any;
  },
  validateCredentials: async (ctx) => {
    adapter.setSafeFetch(ctx.fetch);
    return adapter.validateCredentials(ctx.credentials);
  },
};
```

### OpenAI-compatible adapter

```typescript
import { OpenAICompatibleAdapter, type ProviderModule } from '@gitroom/provider-kernel';
import { metadata as providerMetadata } from './metadata';

const adapter = new OpenAICompatibleAdapter(
  'yourprovider',
  'Your Provider',
  'https://api.yourprovider.com/v1',
  { vision: true },
  [
    {
      id: 'model-v1',
      label: 'Model V1',
      kind: 'text',
      capabilities: {
        text: true,
        image: false,
        vision: true,
        embeddings: false,
        speech: false,
        tools: true,
      },
    },
  ],
  'hub',
);

export const yourproviderAiModule: ProviderModule<any, any> = {
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
  create: (ctx) => {
    adapter.setSafeFetch(ctx.fetch);
    return adapter as any;
  },
  validateCredentials: async (ctx) => {
    adapter.setSafeFetch(ctx.fetch);
    return adapter.validateCredentials(ctx.credentials);
  },
};
```

The `OpenAICompatibleAdapter` automatically:

- Uses `@ai-sdk/openai` under the hood
- Tries to fetch the model list from `{baseURL}/models` if credentials are provided
- Falls back to the provided default models if the `/models` endpoint is unreachable
- Supports `createImageModel`, `createEmbeddingModel`, and `createSpeechModel` when the underlying API does

---

## Step 3: Export the module

`libraries/providers/<id>/src/v1/index.ts`:

```typescript
export { yourproviderAiModule } from './ai.adapter';
```

`libraries/providers/<id>/src/index.ts`:

```typescript
import { yourproviderAiModule } from './v1';

export default [yourproviderAiModule];
```

---

## Step 4: Register in the backend manifest

Add the import and array entry to `apps/backend/src/providers.generated.ts`:

```typescript
import yourproviderModules from '@gitroom/provider-yourprovider';

export const providerModules = [
  // ... existing providers
  ...yourproviderModules,
];
```

`ProvidersBootstrap` registers every module into the kernel at boot. If the `ai` feature flag is enabled (`DEV_DISABLE_AI` is not set), your provider appears in the catalog and can be selected in **Settings → AI**.

---

## Step 5: Credential encryption

Credentials are encrypted at rest via `EncryptionService` (AES-256-GCM, `v2:` prefix). The adapter receives decrypted credentials at call time through the kernel's `ProviderRuntimeContext` — it never stores or logs them. No additional work is needed on the adapter's part.

---

## Step 6: Tests

Write an adapter spec in the provider package, e.g. `libraries/providers/<id>/src/v1/ai.adapter.spec.ts`:

- `validateCredentials()` with valid and invalid credentials
- `listModels()` returns the expected shape
- `createLanguageModel()` / `createLangchainModel()` return valid model objects
- Optional methods return correct types or `undefined`

Mock the underlying AI SDK or the injected `SafeFetchPort` rather than making real API calls.

---

## Current Adapter Inventory

### Bespoke adapters (16)

`openai`, `anthropic`, `google`, `bedrock`, `vertex`, `azure`, `groq`, `fireworks`, `togetherai`, `deepseek`, `mistral`, `cohere`, `perplexity`, `xai`, `gateway`, `openrouter`

### OpenAI-compatible adapters (9)

`siliconflow`, `deepinfra`, `minimax`, `qwen`, `meta-llama`, `gmihub`, `bitdeer`, `lightning`, `vultr`

**Total: 25 providers.**
