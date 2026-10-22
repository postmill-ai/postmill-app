import { metadata as providerMetadata } from './metadata';
import {
  AiSdkMediaAdapter,
  MediaProviderCapabilities,
  MediaCredentialOptions,
  MediaCredentialField,
  ProviderModule,
} from '@postmill-ai/provider-kernel';

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
    outpaint: false,
  };
  override readonly credentialFields: MediaCredentialField[] = [
    { key: 'region', label: 'AWS Region', type: 'string', required: true, placeholder: 'us-east-1' },
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
    { key: 'sessionToken', label: 'Session Token (optional)', type: 'password', required: false },
  ];

  // PRESENCE-only check, mirroring the AI Bedrock adapter's deliberate decision (3.8/5.15):
  // Bedrock exposes no *free* authenticated probe through this adapter (a control-plane
  // ListFoundationModels call would need hand-rolled SigV4), and the AI-SDK bridge's old
  // doGenerate ping burned paid inference. Verify the fields are present and say so honestly
  // rather than implying live verification — real credentials fail on first use.
  override async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    const creds = options?.credentials || {};
    if (!creds.region) return { ok: false, message: 'AWS region is required' };
    if (!creds.accessKeyId || !creds.secretAccessKey) return { ok: false, message: 'AWS credentials are required' };
    return { ok: true, message: 'Credentials saved (AWS credentials are verified on first use — Bedrock has no free connection probe)' };
  }
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
