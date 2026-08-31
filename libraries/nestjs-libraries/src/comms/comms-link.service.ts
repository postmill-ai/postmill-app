import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { CommsConfigRepository } from './comms-config.repository';
import { CommsLinkRepository } from './comms-link.repository';

// Unambiguous alphabet (no 0/O/1/I/L) — the user retypes this into a chat app.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 15 * 60 * 1000;

export interface CommsLinkListItem {
  id: string;
  identifier: string;
  userId: string;
  userEmail: string;
  userName?: string;
  status: string;
  externalDisplayName?: string;
  agentChatEnabled: boolean;
  categories: Record<string, boolean>;
  connectCodeExpiresAt?: Date;
  linkedAt?: Date;
}

@Injectable()
export class CommsLinkService {
  constructor(
    private _links: CommsLinkRepository,
    private _configs: CommsConfigRepository,
  ) {}

  private _generateCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return code;
  }

  async listForOrg(orgId: string): Promise<CommsLinkListItem[]> {
    const rows = await this._links.listForOrg(orgId);
    return rows.map((row) => ({
      id: row.id,
      identifier: row.config.identifier,
      userId: row.userId,
      userEmail: row.user.email,
      userName: row.user.profile?.name ?? undefined,
      status: row.status,
      externalDisplayName: row.externalDisplayName ?? undefined,
      agentChatEnabled: row.agentChatEnabled,
      categories: (row.categories ?? {}) as Record<string, boolean>,
      connectCodeExpiresAt: row.connectCodeExpiresAt ?? undefined,
      linkedAt: row.linkedAt ?? undefined,
    }));
  }

  async createLink(
    orgId: string,
    identifier: string,
    targetUserId: string,
    options: { agentChatEnabled: boolean; categories: Record<string, boolean> },
  ) {
    const config = await this._configs.getByIdentifier(orgId, identifier);
    if (!config) {
      throw new BadRequestException(
        `Configure the ${identifier} comms provider before linking users`,
      );
    }
    const membership = await this._links.isOrgMember(orgId, targetUserId);
    if (!membership) {
      throw new BadRequestException('Target user is not an active member of this organization');
    }
    const existing = await this._links.getByConfigAndUser(config.id, targetUserId);
    if (existing) {
      throw new BadRequestException('This user already has a link for this provider');
    }
    const connectCode = this._generateCode();
    const connectCodeExpiresAt = new Date(Date.now() + CODE_TTL_MS);
    const link = await this._links.create({
      organizationId: orgId,
      configId: config.id,
      userId: targetUserId,
      connectCode,
      connectCodeExpiresAt,
      agentChatEnabled: options.agentChatEnabled,
      categories: options.categories,
    });
    // The one place (besides regenerate) the code is ever returned.
    return { id: link.id, connectCode, expiresAt: connectCodeExpiresAt };
  }

  async updateLink(
    orgId: string,
    id: string,
    data: { agentChatEnabled?: boolean; categories?: Record<string, boolean> },
  ) {
    const { count } = await this._links.update(orgId, id, data);
    if (count === 0) throw new NotFoundException('Link not found');
    return { ok: true };
  }

  async regenerateCode(orgId: string, id: string) {
    const link = await this._links.getById(orgId, id);
    if (!link) throw new NotFoundException('Link not found');
    if (link.status !== 'pending') {
      throw new BadRequestException('Only pending links can get a new connect code');
    }
    const connectCode = this._generateCode();
    const connectCodeExpiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this._links.update(orgId, id, { connectCode, connectCodeExpiresAt });
    return { id, connectCode, expiresAt: connectCodeExpiresAt };
  }

  async deleteLink(orgId: string, id: string) {
    const { count } = await this._links.delete(orgId, id);
    if (count === 0) throw new NotFoundException('Link not found');
    return { ok: true };
  }

  /**
   * Atomic connect-code claim from an inbound chat message. Returns the linked
   * row on success, null when the code is invalid, expired, or already used.
   */
  async claimCode(
    configId: string,
    code: string,
    external: {
      externalUserId: string;
      externalDisplayName?: string;
      externalChannelId?: string;
    },
  ) {
    const normalized = code.trim().toUpperCase();
    if (normalized.length !== CODE_LENGTH) return null;
    const { count } = await this._links.claim(configId, normalized, external);
    if (count === 0) return null;
    return this._links.getByExternalUser(configId, external.externalUserId);
  }
}
