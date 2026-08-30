import { metadata as providerMetadata } from './metadata';
// Sharkey is a Misskey soft-fork with an identical API surface (MiAuth,
// notes, drive), so the channel subclasses the shared kernel Misskey family
// base — only identity and the setup descriptor differ. The same applies to
// other Firefish-lineage servers (Firefish itself is discontinued).
import {
  ChannelSetupDescriptor,
  MisskeyProvider as MisskeyFamilyBase,
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@postmill-ai/provider-kernel';

export class SharkeyProvider extends MisskeyFamilyBase {
  override identifier = 'sharkey';
  override name = 'Sharkey';
  // No flagship Sharkey host exists, so no default — connected channels
  // always carry their instance in the encrypted customInstanceDetails.
  protected override defaultInstanceUrl = '';

  // 'direct' channel: no developer app, no keys. The tenant types their server
  // hostname and authorizes Postmill on it via MiAuth (the externalUrl-style
  // flow on the family base — no app registration is needed at all).
  override setupDescriptor: ChannelSetupDescriptor = {
    authType: 'direct',
    credentialFields: [],
    portalUrl: 'https://joinsharkey.org/instances/',
    portalLabel: 'Sharkey Instance List',
    setupSteps: [
      'Know which Sharkey server your account lives on — you only need its hostname. No account yet? Pick an instance from the list above and sign up.',
      'In Postmill, open the create menu (+) → New Channel and click Sharkey.',
      'Type your server hostname when asked — there is no developer app and no keys to copy.',
      "Your server's authorization page opens: sign in if asked, review the requested permissions (post notes, upload files, read your account), and click Accept — the channel connects right away.",
    ],
  };
}

const __adapter = new SharkeyProvider();

export const sharkeySocialModule: __ProviderModule<any, any> = {
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
