import {
  ProviderModule,
  ProviderRuntimeContext,
  AuthCapability,
  AuthUserInfo,
} from '@gitroom/provider-kernel';
import { randomBytes } from 'crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

import { metadata as providerMetadata } from './metadata';
// Minimal structural type for the ioRedis client the wallet nonce store needs.
// The real client is threaded in via ctx.extras.redis by the auth provider
// manager, so this package never imports nestjs-libraries.
interface RedisLike {
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

// Self-contained kernel auth module for Solana wallet login. Mirrors the legacy
// apps/backend wallet.provider.ts (challenge/response signature verification);
// the legacy class is kept for the PROVIDER_KERNEL=legacy decorator path. Wallet
// has no AuthProviderConfig row, so there is no DB/env credential resolution.

function hexToUint8Array(hex: string): Uint8Array {
  if (hex.startsWith('0x')) {
    hex = hex.slice(2);
  }
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string. It must have an even length.');
  }
  const byteLength = hex.length / 2;
  const uint8Array = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    uint8Array[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return uint8Array;
}

class WalletAuthCapability implements AuthCapability {
  constructor(private readonly _redis: RedisLike) {}

  async generateLink(params?: { publicKey: string }): Promise<string> {
    if (!params?.publicKey) {
      return '';
    }
    const challenge = randomBytes(32).toString('hex');
    await this._redis.set(`wallet:${params.publicKey}`, challenge, 'EX', 60);
    return challenge;
  }

  async getToken(code: string): Promise<string> {
    const { publicKey, challenge, signature } = JSON.parse(
      Buffer.from(code, 'base64').toString(),
    );

    if (!publicKey || !challenge || !signature) {
      return '';
    }

    const redisGet = await this._redis.get(`wallet:${publicKey}`);
    if (redisGet !== challenge) {
      return '';
    }

    const publicKeyUint8 = bs58.decode(publicKey);
    const messageUint8 = new TextEncoder().encode(challenge);
    const signatureUint8 = hexToUint8Array(signature);
    const isValid = nacl.sign.detached.verify(
      messageUint8,
      signatureUint8,
      publicKeyUint8,
    );

    if (!isValid) {
      return '';
    }

    return code;
  }

  async getUser(providerToken: string): Promise<AuthUserInfo> {
    if ((await this.getToken(providerToken)) === '') {
      return { id: '', email: '' };
    }

    const { publicKey } = JSON.parse(
      Buffer.from(providerToken, 'base64').toString(),
    );

    return {
      id: String(`wallet_${publicKey}`),
      email: String(`wallet_${publicKey}`),
    };
  }

  async postRegistration(): Promise<void> {}
}

export const walletAuthModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'auth',
    providerId: 'wallet',
    version: 'v1',
    displayName: 'Wallet',
    status: 'active',
    credentialFields: [],
    capabilities: {},
    authType: 'none',
  },
  create: (ctx: ProviderRuntimeContext) =>
    new WalletAuthCapability(ctx.extras?.redis as RedisLike),
};
