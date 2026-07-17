import { Injectable } from '@nestjs/common';
import { ApiKeysRepository } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api-keys.repository';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeysService {
  constructor(private repo: ApiKeysRepository) {}

  private generateKey(): { plaintext: string; hashedKey: string; prefix: string } {
    const random = crypto.randomBytes(32).toString('base64').replace(/[+/=]/g, '').slice(0, 43);
    const plaintext = `pm_live_${random}`;
    const hashedKey = crypto.createHash('sha256').update(plaintext).digest('hex');
    const prefix = `pm_live_${plaintext.slice(8, 12)}`;
    return { plaintext, hashedKey, prefix };
  }

  async createKey(userId: string, orgId: string, name: string, expiresAt?: string) {
    const { plaintext, hashedKey, prefix } = this.generateKey();
    const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
    await this.repo.create({ organizationId: orgId, userId, name, hashedKey, prefix, expiresAt: expiresAtDate });
    return { plaintext, prefix, name };
  }

  async listKeys(userId: string, orgId: string) {
    return this.repo.listForUserOrg(userId, orgId);
  }

  async findActiveByHash(hash: string) {
    return this.repo.findActiveByHash(hash);
  }

  async revokeKey(id: string, userId: string, orgId: string) {
    return this.repo.revoke(id, userId, orgId);
  }

  async rotateKey(id: string, userId: string, orgId: string, name: string, expiresAt?: string) {
    await this.repo.revoke(id, userId, orgId);
    return this.createKey(userId, orgId, name, expiresAt);
  }

  async touchLastUsed(id: string, orgId: string) {
    return this.repo.touchLastUsed(id, orgId);
  }
}
