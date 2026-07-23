import {
  OpenAICompatibleAdapter,
  type AiModelInfo,
  type ProviderModule,
} from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';

// Curated fallback catalog — used when the live `${baseURL}/models` call is
// unavailable (no key yet, or the endpoint is down). Live entries merge on top.
const KIMI_MODELS: AiModelInfo[] = [
  {
    id: 'kimi-k2-0905-preview',
    label: 'Kimi K2 0905',
    kind: 'text',
    capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true },
  },
  {
    id: 'kimi-k2-turbo-preview',
    label: 'Kimi K2 Turbo',
    kind: 'text',
    capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true },
  },
  {
    id: 'kimi-k2-thinking',
    label: 'Kimi K2 Thinking',
    kind: 'text',
    capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true },
    reasoning: true,
  },
  {
    id: 'kimi-latest',
    label: 'Kimi Latest',
    kind: 'text',
    capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true },
  },
  {
    id: 'moonshot-v1-8k',
    label: 'Moonshot v1 8K',
    kind: 'text',
    capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true },
  },
  {
    id: 'moonshot-v1-32k',
    label: 'Moonshot v1 32K',
    kind: 'text',
    capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true },
  },
  {
    id: 'moonshot-v1-128k',
    label: 'Moonshot v1 128K',
    kind: 'text',
    capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true },
  },
];

const adapter = new OpenAICompatibleAdapter(
  'kimi',
  'Moonshot Kimi',
  'https://api.moonshot.ai/v1',
  { vision: true },
  KIMI_MODELS,
  'direct',
);

export const kimiAiModule: ProviderModule<any, any> = {
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
  // 0.4: thread the injected SSRF-safe fetch into the shared adapter so the
  // `${baseURL}/models` call is validated (never the global fetch on a tenant baseURL).
  create: (ctx) => {
    adapter.setSafeFetch(ctx.fetch);
    return adapter as any;
  },
  validateCredentials: async (ctx) => {
    adapter.setSafeFetch(ctx.fetch);
    return adapter.validateCredentials(ctx.credentials);
  },
};
