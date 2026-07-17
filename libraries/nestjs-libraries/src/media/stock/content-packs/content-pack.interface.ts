// Single source of truth for the content-pack contract + result shapes is now
// the provider kernel. They are re-exported here so existing consumers keep
// their `@gitroom/nestjs-libraries/.../content-pack.interface` import path
// working unchanged. The legacy `ContentPack` interface maps to the kernel's
// `ContentPackCapability` (a superset that also carries identifier/name/
// capabilities), and the legacy `ContentPackCapability` capability-name union
// maps to the kernel's `ContentPackCapabilityName`.
export type {
  ContentPackCapability as ContentPack,
  ContentPackCapabilityName as ContentPackCapability,
} from '@gitroom/provider-kernel';
export { ContentPackDailyCapError } from '@gitroom/provider-kernel';
