/**
 * Per-org channel credential cache, relocated into the kernel (step 7.5.2) so
 * provider packages read `getOrgCredential` without depending on
 * `@gitroom/nestjs-libraries`. The legacy path re-exports these symbols, so the
 * single in-memory cache stays single-instance: IntegrationManager writes via
 * the legacy re-export and providers read from the kernel — both resolve to this
 * one module.
 */
export type CredentialEntry = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  token?: string;
  scopes?: string[];
};

const credentialsCache: Map<string, Map<string, CredentialEntry>> = new Map();

export function setCredentials(
  orgId: string,
  identifier: string,
  entry: CredentialEntry
) {
  let orgCache = credentialsCache.get(orgId);
  if (!orgCache) {
    orgCache = new Map();
    credentialsCache.set(orgId, orgCache);
  }
  orgCache.set(identifier, entry);
}

export function getCredential(
  orgId: string,
  identifier: string,
  key: 'clientId' | 'clientSecret' | 'redirectUri' | 'token'
): string | undefined {
  return credentialsCache.get(orgId)?.get(identifier)?.[key];
}

export function clearOrgCredentials(orgId: string) {
  credentialsCache.delete(orgId);
}

export function clearAllCredentials() {
  credentialsCache.clear();
}

export function clearCredentials() {
  clearAllCredentials();
}

export function replaceCredentialsMap(orgId: string, newMap: Map<string, CredentialEntry>) {
  credentialsCache.set(orgId, new Map(newMap));
}

export function getOrgCredential(
  orgId: string,
  identifier: string,
  key: 'clientId' | 'clientSecret' | 'redirectUri' | 'token'
): string | undefined {
  return getCredential(orgId, identifier, key);
}
