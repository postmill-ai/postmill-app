export interface AuthUserInfo {
  email: string;
  id: string;
  picture?: string | null;
  name?: string | null;
}

export interface AuthCapability {
  generateLink(query?: unknown): Promise<string> | string;
  getToken(code: string, redirectUri?: string): Promise<string>;
  getUser(providerToken: string): Promise<AuthUserInfo> | false;
  postRegistration?(providerToken: string, orgId: string): Promise<void>;
}
