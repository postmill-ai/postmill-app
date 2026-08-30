import { metadata as providerMetadata } from './metadata';
// Misskey implements the Misskey API (MiAuth, notes, drive), so the channel
// subclasses the shared kernel family base — only identity and the setup
// descriptor differ. Sharkey and other Firefish-lineage forks speak the same
// API (Firefish itself is discontinued) and share this base too.
import {
  ChannelSetupDescriptor,
  MisskeyProvider as MisskeyFamilyBase,
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@postmill-ai/provider-kernel';

export class MisskeyProvider extends MisskeyFamilyBase {
  override identifier = 'misskey';
  override name = 'Misskey';
  protected override defaultInstanceUrl = 'https://misskey.io';

  // 'direct' channel: no developer app, no keys. The tenant types their server
  // hostname and authorizes Postmill on it via MiAuth (the externalUrl-style
  // flow on the family base — no app registration is needed at all).
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'direct',
    credentialFields: [],
    portalUrl: 'https://misskey-hub.net/servers/',
    portalLabel: 'Misskey Server List',
    setupSteps: [
      'Know which Misskey server your account lives on (e.g. misskey.io) — you only need its hostname. No account yet? Pick a server from the list above and sign up.',
      'In Postmill, open the create menu (+) → New Channel and click Misskey.',
      'Type your server hostname when asked — there is no developer app and no keys to copy.',
      "Your server's authorization page opens: sign in if asked, review the requested permissions (post notes, upload files, read your account), and click Accept — the channel connects right away.",
    ],
  };
}

const __adapter = new MisskeyProvider();

export const misskeySocialModule: __ProviderModule<any, any> = {
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
