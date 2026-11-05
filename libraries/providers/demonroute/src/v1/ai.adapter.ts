import {
  OpenAICompatibleAdapter,
  type AiModelInfo,
  type ProviderModule,
} from '@postmill-ai/provider-kernel';
import { metadata as providerMetadata } from './metadata';

const DEMONROUTE_MODELS: AiModelInfo[] = [
  {
    id: 'NousResearch/Hermes-3-Llama-3.1-8B',
    label: 'Hermes 3 Llama 3.1 8B',
    kind: 'text',
    capabilities: {
      text: true,
      image: false,
      vision: false,
      embeddings: false,
      speech: false,
      tools: true,
    },
  },
];

const adapter = new OpenAICompatibleAdapter(
  'demonroute',
  'Demon Route',
  'https://api.demonroute.com/v1',
  undefined,
  DEMONROUTE_MODELS,
  'hub'
);

export const demonrouteAiModule: ProviderModule<any, any> = {
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
