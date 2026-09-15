import { Injectable } from '@nestjs/common';

export abstract class AuthProviderAbstract {
  abstract generateLink(query?: any): Promise<string> | string;
  abstract getToken(
    code: string,
    redirectUri?: string,
    state?: string
  ): Promise<string>;
  abstract getUser(
    providerToken: string
  ): Promise<{
    // Optional: providers whose identity can lack an email (e.g. Apple with a
    // hidden relay address) leave it undefined — the registration flow then
    // re-prompts the user for one (emailRequired).
    email?: string;
    id: string;
    picture?: string | null;
    name?: string | null;
  }> | false;
  async postRegistration(
    providerToken: string,
    orgId: string
  ): Promise<void> {}
}

export interface AuthProviderParams {
  provider: string;
}

export function AuthProvider(params: AuthProviderParams) {
  return function (target: any) {
    Injectable()(target);

    const existingMetadata =
      Reflect.getMetadata('auth-provider', AuthProviderAbstract) || [];

    existingMetadata.push({ target, provider: params.provider });

    Reflect.defineMetadata(
      'auth-provider',
      existingMetadata,
      AuthProviderAbstract
    );
  };
}
