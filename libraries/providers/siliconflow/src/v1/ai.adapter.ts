import { OpenAICompatibleAdapter, type ProviderModule } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
const adapter = new OpenAICompatibleAdapter('siliconflow', 'SiliconFlow', 'https://api.siliconflow.cn/v1', {"image":true,"embeddings":true}, undefined, 'hub');

export const siliconflowAiModule: ProviderModule<any, any> = {
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
