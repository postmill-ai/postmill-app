import { metadata as providerMetadata } from './metadata';
// InstagramProvider lives in the kernel as a shared family base (step 7.5.1) so the
// dependent package can extend it without a cross-provider import. This package
// wraps it as the provider-kernel module and exposes the legacy singleton.
import {
  InstagramProvider,
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

export { InstagramProvider };

const __adapter = new InstagramProvider();

export const instagramSocialModule: __ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'social',
    providerId: __adapter.identifier,
    version: 'v1',
    displayName: __adapter.name,
    status: 'active',
    credentialFields: [],
    capabilities: (__CAPS as any)[__adapter.identifier] || {},
  },
  create: (ctx) => new __Bridge(__adapter, ctx),
};
