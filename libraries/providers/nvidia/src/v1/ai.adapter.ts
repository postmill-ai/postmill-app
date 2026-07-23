import {
  OpenAICompatibleAdapter,
  type AiModelInfo,
  type ProviderModule,
} from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';

const NVIDIA_CAPABILITIES = { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true };

// Curated fallback catalog — used when the live `${baseURL}/models` call is
// unavailable (no key yet, or the endpoint is down). Live entries merge on top;
// the hosted NIM catalog lists many more models beyond Nemotron.
const NVIDIA_MODELS: AiModelInfo[] = [
  {
    id: 'nvidia/nemotron-3-super-120b-a12b',
    label: 'Nemotron 3 Super 120B',
    kind: 'text',
    capabilities: NVIDIA_CAPABILITIES,
    reasoning: true,
  },
  {
    id: 'nvidia/nemotron-3-nano-30b-a3b',
    label: 'Nemotron 3 Nano 30B',
    kind: 'text',
    capabilities: NVIDIA_CAPABILITIES,
    reasoning: true,
  },
  {
    id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    label: 'Llama 3.3 Nemotron Super 49B v1.5',
    kind: 'text',
    capabilities: NVIDIA_CAPABILITIES,
    reasoning: true,
  },
  {
    id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    label: 'Llama 3.1 Nemotron Ultra 253B',
    kind: 'text',
    capabilities: NVIDIA_CAPABILITIES,
    reasoning: true,
  },
  {
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    label: 'Llama 3.1 Nemotron 70B Instruct',
    kind: 'text',
    capabilities: NVIDIA_CAPABILITIES,
  },
  {
    id: 'nvidia/nemotron-nano-9b-v2',
    label: 'Nemotron Nano 9B v2',
    kind: 'text',
    capabilities: NVIDIA_CAPABILITIES,
    reasoning: true,
  },
];

const adapter = new OpenAICompatibleAdapter(
  'nvidia',
  'NVIDIA Nemotron',
  'https://integrate.api.nvidia.com/v1',
  { vision: false },
  NVIDIA_MODELS,
  'direct',
);

export const nvidiaAiModule: ProviderModule<any, any> = {
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
