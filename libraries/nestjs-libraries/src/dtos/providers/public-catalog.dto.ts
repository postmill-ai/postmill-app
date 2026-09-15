import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shape of the anonymous `GET /public/integrations/list` catalogue.
 *
 * Deliberately excludes anything that fingerprints the deployment (provider
 * versions, status, credential fields, setup notes, sunset dates) — that
 * detail stays on the authenticated `/providers/catalog`.
 */
export class PublicCatalogProviderDto {
  /** Kernel providerId — stable identifier (storage ids are lower_snake, e.g. `backblaze_b2`). */
  id: string;
  domain: string;
  /** Display name with whitespace collapsed (`Instagram (Standalone)`). */
  name: string;
  /** Localised descriptions keyed by language code (today `en`). */
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  description?: Record<string, string>;
  website?: string;
  /** Absolute URL of the provider icon (PNG for channels/comms, SVG otherwise). */
  icon: string;
  /** Capability keys the provider supports (domain vocabulary, `true` flags only). */
  capabilities: string[];
  /** Channels only: maximum media attachments per post. */
  maxMedia?: number;
  /** Built without live-key verification — shows a Beta badge in the app. */
  beta: boolean;
  /** Platform-curated "featured" flag (super-admin managed). */
  featured: boolean;
  featuredSortOrder?: number;
  /** AI/media only: `direct` (own models) | `hub` (aggregator) | `action` (no model list). */
  kind?: 'direct' | 'hub' | 'action';
  /** Storage only. */
  storageKind?: 'built-in' | 'proprietary' | 's3-compatible';
  /** Media only: generation categories the studio serves. */
  mediaCategories?: string[];
  /** Channels only. */
  editor?: 'none' | 'normal' | 'markdown' | 'html';
  authType?: 'oauth1' | 'oauth2' | 'token' | 'direct';
  /** Channels only: connects to a self-hosted instance URL. */
  selfHosted?: boolean;
  web3?: boolean;
  chromeExtension?: boolean;
  /** Channels only: comment inbox support. */
  comments?: { read: boolean; reply: boolean; like: boolean };
  /** Channels only: @-mention lookup in the composer. */
  mentions?: boolean;
  /** Channels only: ships auto-plug automations. */
  autoPlugs?: boolean;
}

export class PublicCatalogDomainDto {
  id: string;
  /** English label for the bucket (`Channels`, `LLM providers`, …). */
  label: string;
  count: number;
  /** Union of capability keys across the domain, in first-seen order (matrix legend). */
  capabilityKeys: string[];
  providers: PublicCatalogProviderDto[];
}

export class PublicCatalogDto {
  generatedAt: string;
  total: number;
  domains: PublicCatalogDomainDto[];
}
