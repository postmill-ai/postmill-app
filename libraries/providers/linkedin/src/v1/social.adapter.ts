import { metadata as providerMetadata } from './metadata';
// LinkedinProvider lives in the kernel as a shared family base (step 7.5.1) so the
// dependent package can extend it without a cross-provider import. This package
// wraps it as the provider-kernel module and exposes the legacy singleton.
import {
  ChannelSetupDescriptor,
  LinkedinProvider as LinkedinProviderBase,
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@postmill-ai/provider-kernel';

// Package-level subclass so the linkedin-only setup descriptor does not leak
// into the shared kernel family base (linkedin-page extends it separately).
export class LinkedinProvider extends LinkedinProviderBase {
  // Beginner-friendly setup metadata for the per-tenant "Add channel" form.
  // The default callback URL is computed by the catalog
  // (IntegrationManager.getSocialProviderCatalog) — do NOT hardcode it here.
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'oauth2',
    credentialFields: [
      {
        key: 'clientId',
        label: 'Client ID',
        placeholder: 'e.g. 77a1b2c3d4e5f6g7',
        help: 'LinkedIn Developer Portal → your app → Auth tab → Application credentials',
      },
      {
        key: 'clientSecret',
        label: 'Primary Client Secret',
        secret: true,
        help: 'LinkedIn Developer Portal → your app → Auth tab → Application credentials',
      },
    ],
    portalUrl: 'https://www.linkedin.com/developers/apps',
    portalLabel: 'LinkedIn Developer Portal',
    callbackInstructions:
      "In the LinkedIn Developer Portal → your app → Auth tab → OAuth 2.0 settings: add this URL under 'Authorized redirect URLs for your app' and save.",
    setupSteps: [
      'Open the LinkedIn Developer Portal and create an app (or pick an existing one), linked to a LinkedIn Page you admin.',
      "On the Products tab, request access to 'Sign In with LinkedIn using OpenID Connect' and 'Share on LinkedIn'.",
      "On the Auth tab, under OAuth 2.0 settings, add the redirect URL shown below to 'Authorized redirect URLs for your app'.",
      'Copy the Client ID and Primary Client Secret from the Auth tab into the fields below.',
    ],
  };
}

const __adapter = new LinkedinProvider();

export const linkedinSocialModule: __ProviderModule<any, any> = {
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
