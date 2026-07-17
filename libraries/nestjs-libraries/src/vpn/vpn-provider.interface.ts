// The provider contract now lives in the kernel as `VpnCapability`. It is
// re-exported here under the legacy `VpnProviderAdapter` name (identical shape)
// so existing consumers keep their import path working unchanged.
export type { VpnCapability as VpnProviderAdapter } from '@gitroom/provider-kernel';
