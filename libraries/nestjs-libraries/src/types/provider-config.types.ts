export type ProviderConfigStatus = 'configured' | 'active' | 'mounted' | 'enabled' | 'disabled';

export interface ProviderConfigDto {
  id: string;
  organizationId: string;
  identifier: string;
  name?: string;
  enabled: boolean;
  isActive?: boolean;
  mounted?: boolean;
  status: ProviderConfigStatus[];
  displayName?: string;
  capabilities?: string[];
  /** Pinned provider-framework version (e.g. "v1"). */
  version?: string;
  createdAt: Date;
  updatedAt: Date;
}
