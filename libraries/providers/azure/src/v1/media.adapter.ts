import { metadata as providerMetadata } from './metadata';
import {
  AiSdkMediaAdapter,
  MediaProviderCapabilities,
  MediaCredentialOptions,
  MediaCredentialField,
  redactError,
  ProviderModule,
} from '@postmill-ai/provider-kernel';

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
    outpaint: false,
  };
  override readonly credentialFields: MediaCredentialField[] = [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    { key: 'resourceName', label: 'Resource Name', type: 'string', required: true, placeholder: 'my-resource' },
    { key: 'apiVersion', label: 'API Version (optional)', type: 'string', required: false, placeholder: '2024-10-21' },
  ];

  // Free auth check: GET {resource}.openai.azure.com/openai/models is Azure OpenAI's
  // unmetered deployment-catalog read (tokens are billed only on inference). Overrides the
  // AI-SDK bridge delegation, which pings gpt-4o-mini via doGenerate — a PAID call — and
  // requires the AI registry.
  override async testConnection(options?: MediaCredentialOptions): Promise<{ ok: boolean; message: string }> {
    const creds = options?.credentials || {};
    if (!creds.apiKey) return { ok: false, message: 'Azure OpenAI API key is required' };
    if (!creds.resourceName) return { ok: false, message: 'Azure OpenAI resource name is required' };
    // The resource name becomes the request HOST — pin it to a DNS label so a hostile value
    // can't steer the fetch at an arbitrary URL.
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(creds.resourceName)) {
      return { ok: false, message: 'Azure OpenAI resource name is invalid' };
    }
    if (!this._fetch) return { ok: false, message: 'Azure OpenAI connection test is unavailable (no HTTP client)' };
    const apiVersion = creds.apiVersion || '2024-10-21';
    const res = await this._fetch(
      `https://${creds.resourceName}.openai.azure.com/openai/models?api-version=${encodeURIComponent(apiVersion)}`,
      { headers: { 'api-key': creds.apiKey } },
    );
    if (res.ok) return { ok: true, message: 'Connection successful' };
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid API key' };
    throw new Error(`Azure OpenAI connection test failed (${res.status}): ${redactError(await res.text(), 200)}`);
  }
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
  create: (rt) => new AzureMediaAdapter(rt.fetch),
};
