# Adding a VPN / proxy provider

Enables an agent to add a new VPN/egress provider package to the unified provider framework so orgs can route channel posting through its SOCKS5 / HTTP-CONNECT proxies. Reference adapters: `libraries/providers/nordvpn` (static region catalog) and `libraries/providers/custom-proxy` (config-derived region).

Universal package scaffolding, registration, and versioning rules: see `agents/providers/overview.md`. Only VPN-specific deltas are here.

## Contract: `VpnCapability`

Defined in `libraries/providers/kernel/src/domains/vpn.ts`; re-exported under the legacy alias `VpnProviderAdapter` from `libraries/nestjs-libraries/src/vpn/vpn-provider.interface.ts`. Implement it as a plain class — there is **no base class and no wrapper** (unlike shortlink's `BaseShortLinkAdapter`); the module wires the adapter directly via `create: () => new MyAdapter()`.

| Member | Type | Required | Notes |
|---|---|---|---|
| `identifier` | `string` | yes | providerId, e.g. `'nordvpn'`, `'custom'` |
| `name` | `string` | yes | display name |
| `credentialFields` | `VpnCredentialField[]` | yes | `type: 'text' \| 'password' \| 'select'`; drives the settings form |
| `capabilities` | `VpnProviderCapabilities` | yes | all 6 flags, see below |
| `setupNotes` | `string` | no | shown in the settings UI |
| `proxyRegions` | `VpnProxyRegion[]` | one of the two | static catalog of routable egress regions |
| `resolveRegions(config)` | `VpnProxyRegion[]` | one of the two | derive regions from decrypted org config (custom-proxy pattern); **takes precedence over `proxyRegions`**, regions auto-enabled (no per-region toggle) |
| `validateConfig(config)` | `VpnConfigValidationResult` | yes | `{ valid: boolean; errors?: string[] }`; called on save in `OrgVpnConfigService.upsert` |
| `resolveProxyAuth(config)` | `VpnProxyAuth \| null` | required when `proxyRegions` declared | derive `{ username, password }` from stored creds; `null` = region unusable |
| `healthCheck(config)` | `Promise<{ ok; error? }>` | no | backs the "Test connection" button; stub `{ ok: true }` is acceptable (nordvpn does this) |

A provider with **neither** `proxyRegions` nor `resolveRegions` never appears in the per-channel VPN region picker and never routes traffic.

```ts
// VpnProxyRegion — libraries/providers/kernel/src/domains/vpn.ts
interface VpnProxyRegion {
  id: string;        // stable, e.g. 'us-atlanta'
  label: string;     // 'United States — Atlanta'
  host: string;
  port: number;
  protocol: 'socks5' | 'http-connect';   // only these two are routable
}
```

## `VpnProviderCapabilities` flags

Six booleans: `wireguard`, `openvpn`, `ikev2`, `socks5`, `multiHop`, `killSwitch`. They are **display badges only** (rendered as chips via `CAPABILITY_LABELS`/`CAPABILITY_COLORS` in the frontend descriptor). Only providers exposing SOCKS5 / HTTP-CONNECT `VpnProxyRegion`s actually route traffic — WireGuard/OpenVPN/IKEv2 tunnels can't be applied per-request and are out of scope for the dispatch path (kernel comment, `domains/vpn.ts:28-30`). Custom-proxy sets everything false except `socks5`.

## Package layout and module wiring

```
libraries/providers/<id>/
  package.json            # name @postmill-ai/provider-<id>, main/types src/index.ts,
                          # dep @postmill-ai/provider-kernel: workspace:*, script "test": "vitest run"
  src/index.ts            # default-exports ProviderModule[] array
  src/v1/index.ts         # re-export the module
  src/v1/metadata.ts      # ProviderMetadata (id, displayName, kind: 'action', hasModelList: false, ...)
  src/v1/vpn.adapter.ts   # adapter class + module
```

Exact module shape (copied from `nordvpn/src/v1/vpn.adapter.ts:86`):

```ts
const _meta: VpnCapability = new NordvpnAdapter();

export const nordvpnVpnModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'vpn',
    providerId: _meta.identifier,
    version: 'v1',
    displayName: _meta.name,
    status: 'active',
    credentialFields: _meta.credentialFields as any,
    capabilities: _meta.capabilities,
    setupNotes: _meta.setupNotes,
  },
  create: () => new NordvpnAdapter(),
};
```

`manifest.domain: 'vpn'` is the kernel routing key. `metadata.ts` uses the shared `ProviderMetadata` shape whose `domains` array is `["media"]` on both existing VPN adapters — copy it verbatim; it is not what routes the module. `create()` must be pure (no network I/O at construction) — enforced by `runDomainConformance`.

## Region model: static vs dynamic

| | Static (`nordvpn`) | Dynamic (`custom-proxy`) |
|---|---|---|
| Region source | `readonly proxyRegions` array on the adapter | `resolveRegions(config)` derives one region from the org's stored host/port/protocol |
| Per-region toggle | yes — enabled ids stored in `OrgVpnConfig.regions` (JSON `string[]`), validated against the static catalog on upsert | no — derived regions auto-enabled; UI hides the checklist (`isDynamicRegions`) |
| Auth | `resolveProxyAuth` parses `serviceCredentials` (`user:pass`) | `resolveProxyAuth` returns stored `username`/`password` verbatim |
| `healthCheck` | stub `{ ok: true }` | real 5s TCP connect to the configured host:port |

Effective catalog resolution lives in `OrgVpnConfigService._regionsFor` (`libraries/nestjs-libraries/src/vpn/org-vpn-config.service.ts:76`): `resolveRegions` wins if present, else `proxyRegions ?? []`.

## Database

`OrgVpnConfig` (`libraries/nestjs-libraries/src/database/prisma/schema.prisma:1431`): per-org row keyed `@@unique([organizationId, identifier, version])`. Columns: `credentials` (AES-GCM encrypted JSON via `EncryptionService`), `regions` (JSON `string[]` of enabled static-catalog ids), `enabled` (default false), `version` (default `"v1"`, pinned until explicit upgrade). No schema change is needed to add a provider. Credentials are per-org only — there is no env fallback.

Channel opt-in: `OrgProviderConfiguration.vpnSelection` (`schema.prisma:875`) — plaintext JSON `{ enabled, identifier, regionId, vpnVersion }` on the *channel* config. At publish time `post.activity.ts` (`libraries/nestjs-libraries/src/inngest/activities/post.activity.ts:119`) resolves it through `OrgVpnConfigService.resolveProxyForChannel` → `VpnDispatcherService.get`; a null resolution (provider disabled, region removed, creds missing/malformed) means the post egresses from the server IP with a logged warning. Deleting a VPN config nulls orphaned `vpnSelection` rows (`_clearOrphanedChannelSelections`).

## Backend runtime path (no new code needed)

- Resolution: `ProviderResolutionService.resolveVpn` (`libraries/nestjs-libraries/src/providers/provider-resolution.service.ts:341`) — kernel is the sole path.
- Service: `OrgVpnConfigService` (`libraries/nestjs-libraries/src/vpn/org-vpn-config.service.ts`) — lists adapters from `kernel.listManifests('vpn')`, validates the pinned version via `resolveWriteVersion` (deprecated rejects fresh writes, retired 410), encrypts creds only when supplied, and invalidates dispatcher + kernel caches on upsert/delete.
- Controller: `OrgVpnSettingsController` (`apps/backend/src/api/routes/org-vpn-settings.controller.ts`) — `GET /settings/vpn/providers`, `GET /settings/vpn/config`, `PUT /settings/vpn/config/:identifier`, `POST .../test` (throttled 10/min), `DELETE .../config/:identifier`; RBAC `settings:read`/`settings:update`. There is intentionally **no set-active/primary route** — egress selection is per-channel.
- Dispatch: `vpn-dispatcher.factory.ts` builds an undici `Dispatcher` per (org, provider, creds-fingerprint); SOCKS5 sockets go through the `socks` package, HTTP-CONNECT through undici `ProxyAgent`.
- SSRF: `resolveSafeProxyHost` validates the proxy host with `isBlockedIp` and pins a literal IP for the connect leg (DNS-rebinding-safe); the same gate runs before any host-bearing `healthCheck` in `testConnection`. `SSRF_ALLOWED_PRIVATE_CIDRS` is the self-hosted opt-in. An adapter in `libraries/providers/*` can only depend on the kernel, so it cannot run SSRF validation itself — do not try to.

## Frontend (no new code)

The settings UI is catalog-driven by the Provider Settings Kit descriptor `vpnDescriptor` (`apps/frontend/src/components/settings/shared/kit/descriptors/vpn.descriptor.ts`); the tab (`apps/frontend/src/components/settings/vpn/vpn.tab.tsx`) is a 9-line wrapper rendering `<ProviderSettingsPanel descriptor={vpnDescriptor} />`. A new provider appears automatically from `GET /settings/vpn/config` + the kernel catalog (`GET /providers/catalog?domain=vpn`): `credentialFields` render the form, `capabilities` render as chips, static catalogs render the `region-checklist` field, dynamic providers set `isDynamicRegions` and skip it. `features: { toggle: true, primary: false, remove: true, test: true }` is fixed. Only touch the descriptor if you change the six-flag capability set itself.

## Steps

Compressed delta over the universal flow in `agents/providers/overview.md`:

1. Scaffold `libraries/providers/<id>/` per the layout above (copy `nordvpn` for a static catalog, `custom-proxy` for a user-supplied endpoint).
2. Implement `VpnCapability`: `credentialFields`, all six `capabilities` flags, `validateConfig`, plus `proxyRegions`+`resolveProxyAuth` (static) or `resolveRegions`+`resolveProxyAuth` (dynamic); optional `healthCheck`.
3. Export `<id>VpnModule` with `manifest.domain: 'vpn'`, `version: 'v1'`, `status: 'active'`; default-export the module array from `src/index.ts`.
4. Register: dependency in `apps/backend/package.json`, two path mappings in `tsconfig.base.json` (`@postmill-ai/provider-<id>` and `/*`), import + spread in `apps/backend/src/providers.generated.ts` (hand-maintained, alphabetical), then `pnpm install`.
5. Optionally add a featured seed row in `libraries/nestjs-libraries/src/database/seeds/featured-provider.seeder.ts` (`{ domain: 'vpn', providerId: '<id>', sortOrder: n }`).
6. No controller, service, repository, schema, or frontend changes.

## Tests

- Per-package: `pnpm --filter @postmill-ai/provider-<id> test` (vitest). Mirror the two existing specs:
  - Conformance — `nordvpn/src/v1/__tests__/conformance.spec.ts`: `runDomainConformance('vpn', mod, { requiredMethods: ['validateConfig', 'resolveProxyAuth', 'healthCheck'], capabilityKeys: [...] })`.
  - Behavioral — `custom-proxy/src/v1/vpn.adapter.spec.ts`: mocked-`net` tests for `healthCheck`, plus `validateConfig` edge cases.
- Global conformance — `libraries/providers/kernel/src/__tests__/all-providers.conformance.spec.ts` runs every module in `providerModules`; `REQUIRED_METHODS.vpn = ['validateConfig']`. Run `vitest run --root libraries/providers`.
- Service-level — `libraries/nestjs-libraries/src/vpn/org-vpn-config.service.spec.ts` enumerates VPN packages explicitly; add the new import there if the service behavior for your adapter needs coverage.

## Checklist

- [ ] Package scaffolded under `libraries/providers/<id>/` with `package.json` (`@postmill-ai/provider-kernel: workspace:*`, `"test": "vitest run"`).
- [ ] `src/v1/vpn.adapter.ts` implements `VpnCapability` with a routable region source (`proxyRegions` or `resolveRegions`) and `resolveProxyAuth`; without one the provider is a badge-only entry that never routes.
- [ ] `validateConfig` returns `{ valid, errors }` and covers every `required` credential field; `resolveProxyAuth` returns `null` on malformed creds.
- [ ] Module manifest: `domain: 'vpn'`, `version: 'v1'`, `status: 'active'`; `create()` performs no I/O.
- [ ] Registered in `apps/backend/package.json`, `tsconfig.base.json` (both path entries), and `apps/backend/src/providers.generated.ts` (alphabetical); `pnpm install` run.
- [ ] `healthCheck` (if real) opens connections only to config-supplied host/port — SSRF validation is the service's job, not the adapter's.
- [ ] Conformance spec + adapter unit spec added; `pnpm --filter @postmill-ai/provider-<id> test` and `vitest run --root libraries/providers` pass.
- [ ] No backend controller/service/schema or frontend descriptor edits — verify the provider shows up via `GET /settings/vpn/config` and the region picker reflects static vs dynamic behavior.
