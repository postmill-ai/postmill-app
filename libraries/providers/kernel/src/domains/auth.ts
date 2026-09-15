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
  getToken(code: string, redirectUri?: string): Promise<string>;
  getUser(providerToken: string): Promise<AuthUserInfo | false> | false;
  postRegistration?(providerToken: string, orgId: string): Promise<void>;
}
