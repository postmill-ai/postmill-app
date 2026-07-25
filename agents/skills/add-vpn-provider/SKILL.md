---
name: add-vpn-provider
description: Add a VPN/egress proxy provider to Postmill's unified provider kernel — SOCKS5 or HTTP-CONNECT proxy regions for routing channel posting egress. Use when adding a VPN provider, proxy provider, egress proxy region, or SOCKS5/HTTP proxy for channel posting.
---

# Add a VPN / proxy provider

Scaffold a `libraries/providers/<id>` package implementing `VpnCapability` so orgs can route per-channel posting through its SOCKS5 / HTTP-CONNECT proxies. No backend service, schema, or frontend code is required.

## Read first
- `agents/providers/overview.md` — universal package layout, registration, lifecycle, conformance gate
- `agents/providers/vpn.md` — VPN-specific contract deltas, region model, runtime path

## Procedure

1. Pick the region model: **static** catalog (reference `libraries/providers/nordvpn`) or **dynamic** config-derived region (reference `libraries/providers/custom-proxy`, the bring-your-own-proxy adapter).
2. Scaffold `libraries/providers/<id>/`: `package.json` (name `@postmill-ai/provider-<id>`, `main`/`types` = `src/index.ts`, dep `@postmill-ai/provider-kernel: workspace:*`, script `"test": "vitest run"`), `src/index.ts` default-exporting the `ProviderModule[]` array, `src/v1/{index.ts, metadata.ts, vpn.adapter.ts}` (layout detail: `agents/providers/overview.md` § Package layout).
3. Implement the `VpnCapability` contract (`libraries/providers/kernel/src/domains/vpn.ts`) as a plain class — **no base class, no wrapper**:
   - `identifier`, `name`, `credentialFields: VpnCredentialField[]` (`type: 'text' | 'password' | 'select'`), `capabilities` (all 6 flags), `validateConfig(config)` → `{ valid, errors? }`.
   - One of the two region sources: static `proxyRegions?: VpnProxyRegion[]` **or** `resolveRegions(config): VpnProxyRegion[]` (dynamic; takes precedence, regions auto-enabled, no per-region toggle). A provider with neither never routes and never appears in the region picker.
   - `VpnProxyRegion = { id, label, host, port, protocol: 'socks5' | 'http-connect' }` — **only these two protocols route traffic**.
   - `resolveProxyAuth(config): VpnProxyAuth | null` — derive `{ username, password }` from stored creds; return `null` on missing/malformed creds (nordvpn splits `serviceCredentials` on `:`; custom-proxy returns stored username/password verbatim).
   - Optional `healthCheck(config)` backs the "Test connection" button; stub `{ ok: true }` is acceptable (nordvpn), custom-proxy does a real 5s TCP connect.
4. Export the module from `src/v1/vpn.adapter.ts` — copy the exact shape at `nordvpn/src/v1/vpn.adapter.ts:86`: `manifest: { domain: 'vpn', providerId, version: 'v1', displayName, status: 'active', credentialFields, capabilities, setupNotes }`, `create: () => new MyAdapter()`. `manifest.domain: 'vpn'` is the kernel routing key; `create()` must be network-free (conformance-enforced).
5. Author `src/v1/metadata.ts`: copy the existing VPN adapters verbatim (`nordvpn/src/v1/metadata.ts`) — `kind: 'action'`, `domains: ['media']`, `hasModelList: false`. The `domains` array is NOT what routes the module; the manifest domain is.
6. Register (3 file edits + install):
   - `apps/backend/package.json` — add `"@postmill-ai/provider-<id>": "workspace:*"` to dependencies.
   - `tsconfig.base.json` — two path aliases: `"@postmill-ai/provider-<id>": ["libraries/providers/<id>/src"]` and `"@postmill-ai/provider-<id>/*": ["libraries/providers/<id>/src/*"]`.
   - `apps/backend/src/providers.generated.ts` — hand-maintained despite the name: `import <id>Modules from '@postmill-ai/provider-<id>';` and spread `...<id>Modules,` (both alphabetical).
   - Run `pnpm install`.
7. Add specs under `src/v1/__tests__/`: conformance via `runDomainConformance('vpn', mod, { requiredMethods: ['validateConfig', 'resolveProxyAuth', 'healthCheck'], capabilityKeys: [...] })` (mirror `nordvpn/src/v1/__tests__/conformance.spec.ts`) plus a behavioral spec for `validateConfig` edge cases / `healthCheck` (mirror `custom-proxy/src/v1/vpn.adapter.spec.ts`).
8. Optionally seed a featured row in `libraries/nestjs-libraries/src/database/seeds/featured-provider.seeder.ts` (`{ domain: 'vpn', providerId: '<id>', sortOrder: n }`). Update `libraries/providers/PROVIDERS_INVENTORY.md` (row + header counts).
9. No other code: persistence is `OrgVpnConfig` (`schema.prisma:1431`, encrypted creds + enabled region ids, no schema change needed); channel opt-in is `OrgProviderConfiguration.vpnSelection` (`schema.prisma:875`); the frontend settings UI renders from the catalog via `apps/frontend/src/components/settings/shared/kit/descriptors/vpn.descriptor.ts` — `credentialFields` drive the form, `capabilities` render as chips, static catalogs get a region checklist, dynamic providers skip it. Do not touch the descriptor.

## Verify

```bash
pnpm install
vitest run --root libraries/providers/<id>          # package specs
vitest run --root libraries/providers               # global conformance + metadata gate
```

Runtime smoke: `GET /settings/vpn/config` and `GET /providers/catalog?domain=vpn` list the new provider; the per-channel region picker reflects static (checklist) vs dynamic (auto-enabled) behavior.

## Pitfalls

- **Advertising non-proxy protocols as routable.** The six `capabilities` flags (`wireguard`, `openvpn`, `ikev2`, `socks5`, `multiHop`, `killSwitch`) are display-only chips; only declared SOCKS5 / HTTP-CONNECT `VpnProxyRegion`s route traffic. An adapter with no region source is a badge-only entry that never routes.
- **Forgetting `resolveProxyAuth`.** Required whenever `proxyRegions` is declared; without it regions are unusable. Must return `null` (not throw) on malformed creds.
- **Region `protocol` must be exactly `'socks5'` or `'http-connect'`** — no other value is dispatchable.
- **Expecting per-channel routing automatically.** Egress happens only when a channel opts in via `OrgProviderConfiguration.vpnSelection`; a null resolution (provider disabled, region removed, creds malformed) silently falls back to the server IP with a logged warning.
- **Doing SSRF checks in the adapter.** Proxy-host validation lives in the service (`resolveSafeProxyHost`); adapters can only depend on the kernel — connect only to config-supplied host/port in `healthCheck`.
- **"Fixing" `domains: ['media']` in `metadata.ts`** or editing `providers.generated.ts` generation scripts — both are intentional; the former is the shared metadata shape, the latter is hand-maintained.
