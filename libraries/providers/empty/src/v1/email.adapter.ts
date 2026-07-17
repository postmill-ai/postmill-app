import { metadata as providerMetadata } from './metadata';
import {
  EmailCapability,
  EmailAdapterCapabilities,
  EmailSendParams,
  EmailSendResult,
  ProviderModule,
} from '@gitroom/provider-kernel';

export class EmptyAdapter implements EmailCapability {
  readonly name = 'empty';
  readonly capabilities: EmailAdapterCapabilities = {
    webhooks: false,
    openTracking: false,
    clickTracking: false,
  };
  readonly requiredEnvKeys: string[] = [];

  isConfigured(): boolean {
    return false;
  }

  async send(_params: EmailSendParams): Promise<EmailSendResult> {
    return {};
  }
}

const _meta: EmailCapability = new EmptyAdapter();

export const emptyEmailModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'email',
    providerId: _meta.name,
    version: 'v1',
    displayName: _meta.name,
    status: 'active',
    credentialFields: [],
    capabilities: _meta.capabilities,
  },
  create: () => new EmptyAdapter(),
};
