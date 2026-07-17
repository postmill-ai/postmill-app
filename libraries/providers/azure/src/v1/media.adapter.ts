import { metadata as providerMetadata } from './metadata';
import {
  AiSdkMediaAdapter,
  MediaProviderCapabilities,
  MediaCredentialField,
  ProviderModule,
} from '@gitroom/provider-kernel';

// Azure OpenAI — image via DALL·E / gpt-image deployments through @ai-sdk/azure (handled by
// the matching AI Azure adapter via the AI-SDK media bridge).
export class AzureMediaAdapter extends AiSdkMediaAdapter {
  readonly identifier = 'azure';
  readonly name = 'Azure OpenAI';
  readonly capabilities: MediaProviderCapabilities = {
    image: true,
    video: false,
    audio: false,
    avatar: false,
    tts: false,
    stt: false,
    upscale: false,
    bgRemove: false,
    inpaint: false,
  };
  override readonly credentialFields: MediaCredentialField[] = [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    { key: 'resourceName', label: 'Resource Name', type: 'string', required: true, placeholder: 'my-resource' },
    { key: 'apiVersion', label: 'API Version (optional)', type: 'string', required: false, placeholder: '2024-10-21' },
  ];
}

const _meta = new AzureMediaAdapter();

export const azureMediaModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'media',
    providerId: _meta.identifier,
    version: 'v1',
    displayName: _meta.name,
    status: 'active',
    credentialFields: (_meta as any).credentialFields || [],
    capabilities: (_meta as any).capabilities,
  },
  create: () => new AzureMediaAdapter(),
};
