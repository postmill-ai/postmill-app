import { metadata as providerMetadata } from './metadata';
// MastodonProvider lives in the kernel as a shared family base (step 7.5.1) so the
// dependent package can extend it without a cross-provider import. This package
// wraps it as the provider-kernel module and exposes the legacy singleton.
import {
  ChannelSetupDescriptor,
  MastodonProvider as MastodonProviderBase,
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@postmill-ai/provider-kernel';

// Package-level subclass so the mastodon-only setup descriptor does not leak
// into the shared kernel family base (other Mastodon-API providers extend it).
export class MastodonProvider extends MastodonProviderBase {
  // Beginner-friendly setup metadata for the per-tenant "Add channel" form.
  // Mastodon is a 'direct' channel: the tenant registers no developer app and
  // pastes no callback — the channel connects by signing in with the account's
  // own credentials in the composer connect flow, so the form shows guidance
  // only (no credential inputs, no callback block).
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'direct',
    credentialFields: [],
    portalUrl: 'https://joinmastodon.org/servers',
    portalLabel: 'Mastodon Instance',
    setupSteps: [
      'Make sure you have a Mastodon account and know which server it lives on (e.g. mastodon.social). No account yet? Pick a server and sign up via the link above.',
      'Have your sign-in details ready: the E-mail address and Password of your Mastodon account. You enter them on your Mastodon server, never in Postmill.',
      'In Postmill, open the create menu (+) → New Channel and click Mastodon.',
      "On your server's page, sign in with your E-mail address and Password if asked, review the requested permissions, and click Authorize — the channel connects right away.",
    ],
  };
}

const __adapter = new MastodonProvider();

export const mastodonSocialModule: __ProviderModule<any, any> = {
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
