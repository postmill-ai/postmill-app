import { ProviderManifest, type AiCapability, type AiCapabilities } from '@gitroom/provider-kernel';

export const OPENAI_CAPABILITIES: AiCapabilities = {
  text: true,
  image: true,
  vision: true,
  embeddings: true,
  speech: true,
  tools: true,
};

export const openaiAiManifest: ProviderManifest<AiCapabilities> = {
  domain: 'ai',
  providerId: 'openai',
  version: 'v1',
  displayName: 'OpenAI',
  status: 'active',
  credentialFields: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-...' },
    { key: 'baseURL', label: 'Base URL', type: 'string', required: false, placeholder: 'https://api.openai.com/v1' },
    { key: 'organization', label: 'Organization ID', type: 'string', required: false, placeholder: 'org-...' },
  ],
  capabilities: OPENAI_CAPABILITIES,
  universalCredentialFrom: 'ai',
  docsUrl: 'https://platform.openai.com/docs',
};
