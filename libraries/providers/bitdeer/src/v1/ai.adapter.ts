import { OpenAICompatibleAdapter, type ProviderModule } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
const adapter = new OpenAICompatibleAdapter('bitdeer', 'Bitdeer AI', 'https://ai.bitdeer.com/v1', undefined, undefined, 'hub');

export const bitdeerAiModule: ProviderModule<any, any> = {
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
