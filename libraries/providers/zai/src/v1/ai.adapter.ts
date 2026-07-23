import {
  OpenAICompatibleAdapter,
  type AiModelInfo,
  type ProviderModule,
} from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';

// Curated fallback catalog — used when the live `${baseURL}/models` call is
// unavailable (no key yet, or the endpoint is down). Live entries merge on top.
const ZAI_MODELS: AiModelInfo[] = [
  {
    id: 'glm-4.6',
    label: 'GLM-4.6',
    kind: 'text',
    capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true },
    reasoning: true,
  },
  {
    id: 'glm-4.5',
    label: 'GLM-4.5',
    kind: 'text',
    capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true },
    reasoning: true,
  },
  {
    id: 'glm-4.5-air',
    label: 'GLM-4.5 Air',
    kind: 'text',
    capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true },
  },
  {
    id: 'glm-4.5-flash',
    label: 'GLM-4.5 Flash',
    kind: 'text',
    capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true },
  },
  {
    id: 'glm-4.5v',
    label: 'GLM-4.5V',
    kind: 'text',
    capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true },
  },
  {
    id: 'glm-4-plus',
    label: 'GLM-4 Plus',
    kind: 'text',
    capabilities: { text: true, image: false, vision: true, embeddings: false, speech: false, tools: true },
  },
];

const adapter = new OpenAICompatibleAdapter(
  'zai',
  'Z.AI GLM',
  'https://api.z.ai/api/paas/v4',
  { vision: true },
  ZAI_MODELS,
  'direct',
);

export const zaiAiModule: ProviderModule<any, any> = {
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
