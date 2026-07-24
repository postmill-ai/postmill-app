// Single source of truth for these types is now the provider kernel. They are
// re-exported here so existing consumers (services, dispatcher, registry, specs)
// keep their `@postmill-ai/nestjs-libraries/vpn/vpn.types` import path working
// unchanged.
export type {
  VpnCredentialFieldType,
  VpnCredentialField,
  VpnProviderCapabilities,
  VpnConfigValidationResult,
  VpnProxyProtocol,
  VpnProxyRegion,
  VpnProxyAuth,
} from '@postmill-ai/provider-kernel';
