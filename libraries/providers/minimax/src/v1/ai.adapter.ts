import { OpenAICompatibleAdapter, type ProviderModule } from '@postmill-ai/provider-kernel';

import { metadata as providerMetadata } from './metadata';
// MiniMax keys are platform-specific and NOT interchangeable: international
// (api.minimax.io) vs mainland China (api.minimaxi.com; api.minimax.chat is the
// legacy China host). Default to the international platform — the media adapter
// already does. China-platform keys work by setting the optional Base URL
// credential field to https://api.minimaxi.com/v1.
const adapter = new OpenAICompatibleAdapter(
  'minimax',
  'MiniMax',
  'https://api.minimax.io/v1',
  { image: true },
  undefined,
  'direct',
  { ipFamily: 4 },
);

export const minimaxAiModule: ProviderModule<any, any> = {
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
