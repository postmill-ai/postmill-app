import { ProviderManifest, type MediaCapability, type MediaProviderCapabilities } from '@gitroom/provider-kernel';

export const OPENAI_MEDIA_CAPABILITIES: MediaProviderCapabilities = {
  image: true,
  video: true,
  audio: true,
  avatar: false,
  tts: true,
  stt: true,
  upscale: false,
  bgRemove: false,
  inpaint: false,
};

export const openaiMediaManifest: ProviderManifest<MediaProviderCapabilities> = {
  domain: 'media',
  providerId: 'openai',
  version: 'v1',
  displayName: 'OpenAI',
  status: 'active',
  credentialFields: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-...' },
  ],
  capabilities: OPENAI_MEDIA_CAPABILITIES,
  universalCredentialFrom: 'ai',
  docsUrl: 'https://platform.openai.com/docs',
};
