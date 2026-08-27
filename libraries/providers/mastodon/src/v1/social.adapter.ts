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
  // pastes no callback — connecting means typing the instance hostname, after
  // which Postmill registers itself on that server automatically (the
  // `externalUrl` dynamic client registration flow) and the user authorizes
  // on their own server. The form therefore shows guidance only (no
  // credential inputs, no callback block).
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'direct',
    credentialFields: [],
    portalUrl: 'https://joinmastodon.org/servers',
    portalLabel: 'Mastodon Instance',
    setupSteps: [
      'Know which Mastodon server your account lives on (e.g. mastodon.social) — you only need its hostname. No account yet? Pick a server and sign up via the link above.',
      'In Postmill, open the create menu (+) → New Channel and click Mastodon.',
      'Type your server hostname when asked — Postmill registers itself on your server automatically. No developer app, no keys to copy.',
      "Your server's page opens: sign in with your Mastodon E-mail address and Password if asked, review the requested permissions, and click Authorize — the channel connects right away.",
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
