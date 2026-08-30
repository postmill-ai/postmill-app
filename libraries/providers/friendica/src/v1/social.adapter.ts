import { metadata as providerMetadata } from './metadata';
// Friendica implements the Mastodon client API (apps registration, OAuth,
// statuses, media), so the channel subclasses the shared kernel family base —
// only identity, limits, and the setup descriptor differ.
import {
  ChannelSetupDescriptor,
  MastodonProvider as MastodonFamilyBase,
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@postmill-ai/provider-kernel';

export class FriendicaProvider extends MastodonFamilyBase {
  override identifier = 'friendica';
  override name = 'Friendica';
  // Friendica's status length limit is instance-configured; 5000 is the common
  // default across public servers.
  override maxLength() {
    return 5000;
  }

  // 'direct' channel: no developer app, no keys. The tenant types their server
  // hostname and Postmill registers itself on it (the externalUrl dynamic
  // client registration flow on the family base).
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'direct',
    credentialFields: [],
    portalUrl: 'https://dir.friendica.social/servers',
    portalLabel: 'Friendica Server Directory',
    setupSteps: [
      'Know which Friendica server your account lives on — you only need its hostname. No account yet? Pick a server from the directory above and sign up.',
      'In Postmill, open the create menu (+) → New Channel and click Friendica.',
      'Type your server hostname when asked — Postmill registers itself on your server automatically. No developer app, no keys to copy.',
      "Your server's page opens: sign in with your Friendica account if asked, review the requested permissions, and click Authorize — the channel connects right away.",
    ],
  };
}

const __adapter = new FriendicaProvider();

export const friendicaSocialModule: __ProviderModule<any, any> = {
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
