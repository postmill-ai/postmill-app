// Single source of truth for the content-pack contract + result shapes is now
// the provider kernel. They are re-exported here so existing consumers keep
// their `@postmill-ai/nestjs-libraries/.../content-pack.interface` import path
// working unchanged. The legacy `ContentPack` interface maps to the kernel's
// `ContentPackCapability` (a superset that also carries identifier/name/
// capabilities), and the legacy `ContentPackCapability` capability-name union
// maps to the kernel's `ContentPackCapabilityName`.
export type {
  ContentPackCapability as ContentPack,
  ContentPackCapabilityName as ContentPackCapability,
} from '@postmill-ai/provider-kernel';
export { ContentPackDailyCapError } from '@postmill-ai/provider-kernel';
