import {
  OpenAICompatibleAdapter,
  type AiModelInfo,
  type ProviderModule,
} from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';

// Apertus is text-only and does not support OpenAI-style tool calling (only
// manual template-driven approaches) — keep tools/vision off so the agent and
// tool surfaces don't offer it.
const APERTUS_CAPABILITIES = { text: true, image: false, vision: false, embeddings: false, speech: false, tools: false };

// Curated fallback catalog — used when the live `${baseURL}/models` call is
// unavailable (no key yet, or the endpoint is down). Live entries merge on top.
const APERTUS_MODELS: AiModelInfo[] = [
  {
    id: 'swiss-ai/apertus-8b-instruct',
    label: 'Apertus 8B Instruct',
    kind: 'text',
    capabilities: APERTUS_CAPABILITIES,
  },
  {
    id: 'swiss-ai/apertus-70b-instruct',
    label: 'Apertus 70B Instruct',
    kind: 'text',
    capabilities: APERTUS_CAPABILITIES,
  },
];

const adapter = new OpenAICompatibleAdapter(
  'apertus',
  'Apertus',
  'https://api.publicai.co/v1',
  { vision: false, tools: false },
  APERTUS_MODELS,
  'direct',
);

export const apertusAiModule: ProviderModule<any, any> = {
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
