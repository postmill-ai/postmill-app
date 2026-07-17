import { metadata as providerMetadata } from './metadata';
import {
  AiSdkMediaAdapter,
  MediaProviderCapabilities,
  MediaCredentialField,
  ProviderModule,
} from '@gitroom/provider-kernel';

// AWS Bedrock — image via Amazon Titan / Nova Canvas, auth = SigV4 through
// @ai-sdk/amazon-bedrock (handled by the matching AI Bedrock adapter via the AI-SDK media
// bridge). Multi-field credentials mirror the AI Bedrock adapter.
export class BedrockMediaAdapter extends AiSdkMediaAdapter {
  readonly identifier = 'bedrock';
  readonly name = 'Amazon Bedrock';
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
    { key: 'region', label: 'AWS Region', type: 'string', required: true, placeholder: 'us-east-1' },
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
    { key: 'sessionToken', label: 'Session Token (optional)', type: 'password', required: false },
  ];
}

const _meta = new BedrockMediaAdapter();

export const bedrockMediaModule: ProviderModule<any, any> = {
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
  create: () => new BedrockMediaAdapter(),
};
