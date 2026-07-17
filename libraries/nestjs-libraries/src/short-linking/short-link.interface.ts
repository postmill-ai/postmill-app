// Single source of truth for these types is now the provider kernel. They are
// re-exported here so existing consumers (services, registry, controllers, specs)
// keep their `@gitroom/nestjs-libraries/short-linking/short-link.interface`
// import path working unchanged. The legacy `ShortLinkAdapter` name maps to the
// kernel's `ShortLinkCapability` (identical shape).
export type {
  ShortLinkCapability as ShortLinkAdapter,
  ShortLinkCredentialField,
  ShortLinkCapabilities,
  ShortLinkContext,
  ShortLinkStat,
} from '@gitroom/provider-kernel';
