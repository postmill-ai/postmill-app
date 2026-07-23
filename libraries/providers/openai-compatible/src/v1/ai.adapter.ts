import {
  OpenAICompatibleAdapter,
  type ProviderModule,
} from '@postmill-ai/provider-kernel';

import { metadata as providerMetadata } from './metadata';

// Generic endpoint-bringing provider: there is no canonical base URL of its
// own, so Base URL is a REQUIRED org setting (requireBaseURL). The SSRF guard
// in OrgAiSettingsService still restricts it to public HTTPS endpoints — this
// provider targets hosted OpenAI-compatible APIs, not local servers.
const adapter = new OpenAICompatibleAdapter(
  'openai-compatible',
  'OpenAI Compatible',
  '',
  undefined,
  undefined,
  'hub',
  { requireBaseURL: true },
);

export const openaiCompatibleAiModule: ProviderModule<any, any> = {
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
