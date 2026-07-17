export type VpnCredentialFieldType = 'text' | 'password' | 'select';

export interface VpnCredentialField {
  key: string;
  label: string;
  type: VpnCredentialFieldType;
  required: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
}

export interface VpnProviderCapabilities {
  wireguard: boolean;
  openvpn: boolean;
  ikev2: boolean;
  socks5: boolean;
  multiHop: boolean;
  killSwitch: boolean;
}

export interface VpnConfigValidationResult {
  valid: boolean;
  errors?: string[];
}

export type VpnProxyProtocol = 'socks5' | 'http-connect';

// A selectable egress region backed by a real proxy endpoint. Only providers
// that expose a public SOCKS5 / HTTP-CONNECT proxy declare these; WireGuard /
// OpenVPN tunnels can't be applied per-request and are out of scope.
export interface VpnProxyRegion {
  id: string; // stable, e.g. 'us-atlanta'
  label: string; // 'United States — Atlanta'
  host: string; // proxy endpoint host
  port: number;
  protocol: VpnProxyProtocol;
}

export interface VpnProxyAuth {
  username: string;
  password: string;
}

export interface VpnCapability {
  readonly identifier: string;
  readonly name: string;
  readonly credentialFields: VpnCredentialField[];
  readonly capabilities: VpnProviderCapabilities;
  readonly setupNotes?: string;

  /**
   * Static catalog of egress regions this provider exposes as request-routable
   * proxies. Present only on SOCKS5 / HTTP-CONNECT-capable providers; absent ⇒
   * the provider has no fixed catalog (it may still derive regions dynamically —
   * see `resolveRegions`). A provider with neither never appears in the
   * per-channel VPN region picker and never routes traffic.
   */
  readonly proxyRegions?: VpnProxyRegion[];

  /**
   * Derive regions from the org's stored config instead of a fixed catalog —
   * used by the generic "bring-your-own proxy" adapter where the endpoint
   * (host/port/protocol) IS the region. When present, it takes precedence over
   * `proxyRegions` and the region is auto-enabled (no per-region toggle).
   */
  resolveRegions?(config: Record<string, string>): VpnProxyRegion[];

  validateConfig(config: Record<string, string>): VpnConfigValidationResult;

  /**
   * Derive the proxy username/password from the stored credentials. Required on
   * providers that declare `proxyRegions`. Returns null when creds are missing
   * or malformed.
   */
  resolveProxyAuth?(config: Record<string, string>): VpnProxyAuth | null;

  /**
   * Optional health-check stub. In this credential-only phase it is a no-op
   * placeholder; later it can attempt a lightweight API/status probe.
   */
  healthCheck?(config: Record<string, string>): Promise<{ ok: boolean; error?: string }>;
}
