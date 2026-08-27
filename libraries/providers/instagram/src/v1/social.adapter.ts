import { metadata as providerMetadata } from './metadata';
// InstagramProvider lives in the kernel as a shared family base (step 7.5.1) so the
// dependent package can extend it without a cross-provider import. This package
// wraps it as the provider-kernel module and exposes the legacy singleton.
import {
  ChannelSetupDescriptor,
  InstagramProvider,
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@postmill-ai/provider-kernel';

export { InstagramProvider };

// The kernel InstagramProvider is a shared family base (instagram-standalone
// borrows it internally and uses a different auth model), so the
// channel-specific setup descriptor lives on this subclass, not on the base.
class InstagramChannelProvider extends InstagramProvider {
  // Beginner-friendly setup metadata for the per-tenant "Add channel" form.
  // The default callback URL is computed by the catalog
  // (IntegrationManager.getSocialProviderCatalog) — do NOT hardcode it here.
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'oauth2',
    credentialFields: [
      {
        key: 'clientId',
        label: 'App ID',
        placeholder: 'e.g. 1234567890123456',
        help: 'Meta for Developers → your app → App settings → Basic',
      },
      {
        key: 'clientSecret',
        label: 'App Secret',
        secret: true,
        help: 'Meta for Developers → your app → App settings → Basic',
      },
    ],
    portalUrl: 'https://developers.facebook.com/apps',
    portalLabel: 'Meta for Developers',
    callbackInstructions:
      'In Meta for Developers → your app, add the "Facebook Login" product, then open Facebook Login → Settings and paste this URL into "Valid OAuth Redirect URIs".',
    setupSteps: [
      'Open Meta for Developers and create an app (type "Business"), or pick an existing one.',
      'Add the "Facebook Login" product to the app.',
      'Under Facebook Login → Settings, add the callback URL shown below to "Valid OAuth Redirect URIs".',
      'Copy the App ID and App Secret from App settings → Basic into the fields below.',
      'Connect an Instagram professional (Business or Creator) account that is linked to a Facebook Page.',
    ],
  };
}

const __adapter = new InstagramChannelProvider();

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
