import type { ProviderManifest } from '@gitroom/provider-kernel';
import { ContentPackCapability } from './content-pack.interface';

export interface ContentPackCredentialField {
  key: string;
  label: string;
  required: boolean;
}

export interface ContentPackMeta {
  identifier: string;
  name: string;
  capabilities: ContentPackCapability[];
  credentialFields: ContentPackCredentialField[];
}

// The content-pack metadata catalog is no longer a hardcoded object — the
// provider kernel is the single source of truth. The 4 packs are workspace
// provider packages (libraries/providers/{magnific,vecteezy,adobe-stock,envato})
// registered with the kernel at bootstrap; their manifests carry displayName,
// capabilities, and credentialFields. Consumers resolve the live catalog via
// `ProviderResolutionService.listManifests('contentpack')` and project each
// manifest into the legacy `ContentPackMeta` shape with the helper below.
export function manifestToContentPackMeta(
  manifest: ProviderManifest
): ContentPackMeta {
  return {
    identifier: manifest.providerId,
    name: manifest.displayName,
    capabilities: (manifest.capabilities as ContentPackCapability[]) ?? [],
    credentialFields: (manifest.credentialFields ?? []).map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required,
    })),
  };
}
