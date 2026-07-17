'use client';

// Shared response/types for the content-packs surface. The data is fetched via
// the kit descriptor's `load` (see content-packs.descriptor.ts) on the
// 'org-content-packs-config' SWR key; these interfaces type that payload.

export interface ContentPackProviderInfo {
  identifier: string;
  name: string;
  capabilities: string[];
  isConfigured: boolean;
  isActive: boolean;
  version: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ContentPackConfigResponse {
  active: {
    identifier: string;
    name: string;
    capabilities: string[];
  } | null;
  providers: ContentPackProviderInfo[];
}
