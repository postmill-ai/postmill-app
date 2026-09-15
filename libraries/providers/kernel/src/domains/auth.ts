export interface AuthUserInfo {
  // Optional: providers whose identity can lack an email (e.g. Apple with a
  // hidden relay address) leave it undefined; AuthService.checkExists then
  // flags the registration flow to re-prompt for one (emailRequired).
  email?: string;
  id: string;
  picture?: string | null;
  name?: string | null;
}

export interface AuthCapability {
  generateLink(query?: unknown): Promise<string> | string;
  // `state` is the OAuth state echoed back by the provider's callback —
  // adapters that bind per-attempt secrets to it (X: PKCE verifier) need it.
  getToken(code: string, redirectUri?: string, state?: string): Promise<string>;
  getUser(providerToken: string): Promise<AuthUserInfo | false> | false;
  postRegistration?(providerToken: string, orgId: string): Promise<void>;
}
