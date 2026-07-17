import { describe, it, expect } from 'vitest';
import type { ProviderManifest } from '@gitroom/provider-kernel';
import { manifestToContentPackMeta } from './content-pack.registry';

// The adapter implementations + their behavioural tests now live in their own
// workspace packages (libraries/providers/{magnific,vecteezy,adobe-stock,envato}),
// and the metadata catalog is sourced from the provider kernel at runtime. This
// spec covers the projection helper that maps a kernel manifest into the legacy
// `ContentPackMeta` shape consumed by the settings surfaces.

describe('manifestToContentPackMeta', () => {
  const manifest: ProviderManifest = {
    domain: 'contentpack',
    providerId: 'envato',
    version: 'v1',
    displayName: 'Envato Elements',
    status: 'active',
    credentialFields: [
      { key: 'apiKey', label: 'API Token', type: 'password', required: true },
    ],
    capabilities: ['photos', 'vectors', 'videos', 'audio'],
  };

  it('projects identifier, name, capabilities and credential fields', () => {
    const meta = manifestToContentPackMeta(manifest);
    expect(meta.identifier).toBe('envato');
    expect(meta.name).toBe('Envato Elements');
    expect(meta.capabilities).toEqual(['photos', 'vectors', 'videos', 'audio']);
    expect(meta.credentialFields).toEqual([
      { key: 'apiKey', label: 'API Token', required: true },
    ]);
  });

  it('drops kernel-only credential-field props (e.g. type) from the legacy shape', () => {
    const meta = manifestToContentPackMeta(manifest);
    expect(meta.credentialFields[0]).not.toHaveProperty('type');
  });
});
