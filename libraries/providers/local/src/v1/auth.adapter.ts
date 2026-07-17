import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  AuthCapability,
} from '@gitroom/provider-kernel';

// Kernel auth module for LOCAL (email + password) login.
//
// LOCAL has no legacy AuthProviderAbstract class and no OAuth/token flow: it is
// always available (unless DISABLE_REGISTRATION) and is special-cased directly in
// the auth resolver/service, not via getUser(providerToken). This module exists so
// the kernel catalog knows LOCAL is a registered auth provider; the OAuth-style
// methods are inert stubs and must not be used for password authentication.

class LocalAuthCapability implements AuthCapability {
  generateLink(): string {
    return '';
  }

  async getToken(): Promise<string> {
    throw new Error('LOCAL auth does not use a provider token flow');
  }

  getUser(): false {
    return false;
  }

  async postRegistration(): Promise<void> {}
}

export const localAuthModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'auth',
    providerId: 'local',
    version: 'v1',
    displayName: 'Email & Password',
    status: 'active',
    credentialFields: [],
    capabilities: {},
    authType: 'none',
  },
  create: () => new LocalAuthCapability(),
};
