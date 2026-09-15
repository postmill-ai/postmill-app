import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { Provider } from '@prisma/client';
import { timingSafeStringEqual } from '@postmill-ai/provider-kernel';
import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { IntegrationRepository } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationService } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@postmill-ai/nestjs-libraries/integrations/integration.manager';
import { PostsService } from '@postmill-ai/nestjs-libraries/database/prisma/posts/posts.service';
import { UsersRepository } from '@postmill-ai/nestjs-libraries/database/prisma/users/users.repository';
import { AuthProviderRepository } from '@postmill-ai/nestjs-libraries/database/prisma/auth-providers/auth-provider.repository';
import { EncryptionService } from '@postmill-ai/nestjs-libraries/encryption/encryption.service';
import { AuditService } from '@postmill-ai/nestjs-libraries/database/prisma/audit/audit.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';

/**
 * Meta's app-level callbacks (Deauthorize Callback URL + Data Deletion
 * Request Callback URL), shared by the Facebook, Instagram and Threads apps.
 *
 * Meta POSTs `signed_request=<base64url(sig)>.<base64url(json)>`, the signature
 * being HMAC-SHA256 over the payload segment with the APP SECRET, payload
 * `{ user_id, algorithm: 'HMAC-SHA256', issued_at }`. Which app sent it is not
 * in the payload — we try every configured Meta secret and the first that
 * verifies identifies the app family, which in turn scopes which channel
 * providers can hold that user's data.
 */

export type MetaFamily = 'facebook' | 'instagram-standalone' | 'threads';

export type MetaSignedPayload = {
  user_id: string;
  algorithm?: string;
  issued_at?: number;
  [key: string]: unknown;
};

export type MetaDeletionStatus = {
  code: string;
  status: 'completed' | 'unknown';
  family?: MetaFamily;
  requestedAt?: string;
  completedAt?: string;
  channels?: number;
  notes?: string[];
};

// Which channel providers are backed by which Meta app (secret).
const FAMILY_PROVIDERS: Record<MetaFamily, string[]> = {
  facebook: ['facebook', 'instagram'],
  'instagram-standalone': ['instagram-standalone'],
  threads: ['threads'],
};

const DELETION_STATUS_TTL_SECONDS = 180 * 24 * 60 * 60;
const CONFIRMATION_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const metaDeletionStatusKey = (code: string) => `meta:deletion:${code}`;

const base64UrlDecode = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

@Injectable()
export class MetaCallbacksService {
  private readonly _logger = new Logger(MetaCallbacksService.name);

  constructor(
    private _prisma: PrismaService,
    private _integrationRepository: IntegrationRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _postsService: PostsService,
    private _usersRepository: UsersRepository,
    private _authProviderRepository: AuthProviderRepository,
    private _encryption: EncryptionService,
    private _auditService: AuditService,
  ) {}

  /** Every Meta app secret this deployment knows, with the family it proves. */
  private async _secretCandidates(): Promise<Array<{ family: MetaFamily; secret: string; source: string }>> {
    const candidates: Array<{ family: MetaFamily; secret: string; source: string }> = [];
    const env = (family: MetaFamily, name: string) => {
      const value = process.env[name];
      if (value) candidates.push({ family, secret: value, source: name });
    };
    env('facebook', 'FACEBOOK_APP_SECRET');
    env('instagram-standalone', 'INSTAGRAM_APP_SECRET');
    env('threads', 'THREADS_APP_SECRET');
    // Facebook SSO may run on a different app than the posting channel.
    try {
      const sso = await this._authProviderRepository.findByProvider(Provider.FACEBOOK);
      if (sso?.enabled && sso.clientSecret) {
        candidates.push({
          family: 'facebook',
          secret: this._encryption.decrypt(sso.clientSecret),
          source: 'AuthProviderConfig(FACEBOOK)',
        });
      }
    } catch {
      /* SSO config unavailable — env candidates still apply */
    }
    return candidates;
  }

  /**
   * Verify a Meta signed_request against every configured app secret.
   * Returns null when nothing verifies (malformed, wrong algorithm, tampered,
   * or from an app this deployment does not know).
   */
  async parseSignedRequest(
    signedRequest: unknown,
  ): Promise<{ family: MetaFamily; source: string; payload: MetaSignedPayload } | null> {
    if (typeof signedRequest !== 'string') return null;
    const [sigB64, payloadB64] = signedRequest.split('.');
    if (!sigB64 || !payloadB64) return null;

    let payload: MetaSignedPayload;
    try {
      payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
    } catch {
      return null;
    }
    if (!payload || typeof payload !== 'object') return null;
    if ((payload.algorithm || '').toUpperCase() !== 'HMAC-SHA256') return null;
    if (!payload.user_id) return null;

    const signature = base64UrlDecode(sigB64).toString('hex');
    for (const candidate of await this._secretCandidates()) {
      const expected = createHmac('sha256', candidate.secret).update(payloadB64).digest('hex');
      if (timingSafeStringEqual(expected, signature)) {
        return {
          family: candidate.family,
          source: candidate.source,
          payload: { ...payload, user_id: String(payload.user_id) },
        };
      }
    }
    return null;
  }

  findIntegrations(family: MetaFamily, userId: string) {
    return this._integrationRepository.findByMetaUser(FAMILY_PROVIDERS[family], userId);
  }

  /**
   * Deauthorize: the user removed the app on Meta's side. Their channels can
   * no longer publish, so mark them reconnect-needed (badge + notification,
   * same path as an expired token). Nothing is deleted.
   */
  async deauthorize(family: MetaFamily, userId: string): Promise<{ channels: number }> {
    const integrations = await this.findIntegrations(family, userId);
    if (!integrations.length) {
      this._logger.warn(`meta deauthorize (${family}): no channel matches user_id ${userId}`);
      return { channels: 0 };
    }
    const orgIds = new Set<string>();
    for (const integration of integrations) {
      await this._integrationService.disconnectChannel(integration.organizationId, integration);
      orgIds.add(integration.organizationId);
      await this._audit({
        organizationId: integration.organizationId,
        action: 'integration.deauthorized-by-provider',
        entity: 'integration',
        entityId: integration.id,
        entityName: integration.name,
        details: `Meta deauthorize callback (${family}, user ${userId})`,
      });
    }
    for (const orgId of orgIds) {
      await this._integrationManager.invalidateIntegrationListCache(orgId);
    }
    this._logger.log(`meta deauthorize (${family}): disconnected ${integrations.length} channel(s) for user ${userId}`);
    return { channels: integrations.length };
  }

  /**
   * Data deletion: purge everything obtained from Meta for that user, keep the
   * user's own drafts restorable (soft-deleted), and record a status the user
   * can look up with the confirmation code Meta shows them.
   */
  async requestDeletion(
    family: MetaFamily,
    userId: string,
  ): Promise<{ url: string; confirmation_code: string; status: MetaDeletionStatus }> {
    const code = this._confirmationCode();
    const requestedAt = new Date().toISOString();
    const notes: string[] = [];

    const integrations = await this.findIntegrations(family, userId);
    if (!integrations.length) {
      this._logger.warn(`meta data-deletion (${family}): no channel matches user_id ${userId}`);
    }
    const orgIds = new Set<string>();
    for (const integration of integrations) {
      const groups = await this._integrationService.getPostsForChannel(integration.organizationId, integration.id);
      for (const post of groups) {
        await this._postsService.deletePost(integration.organizationId, post.group).catch((err: Error) => {
          this._logger.warn(`meta data-deletion: deletePost ${post.group} failed: ${err.message}`);
        });
      }
      await this.purgeChannelData(integration.organizationId, integration.id);
      orgIds.add(integration.organizationId);
      await this._audit({
        organizationId: integration.organizationId,
        action: 'integration.deleted-by-provider',
        entity: 'integration',
        entityId: integration.id,
        entityName: integration.name,
        details: `Meta data deletion request (${family}, user ${userId}, confirmation ${code})`,
      });
    }
    for (const orgId of orgIds) {
      await this._integrationManager.invalidateIntegrationListCache(orgId);
    }

    // A Postmill account created via "Login with Facebook" carries Meta data
    // too. Account deletion is never triggered from an inbound webhook — the
    // status tells the person how to ask for it.
    if (family === 'facebook') {
      const ssoUser = await this._usersRepository.getUserByProvider(userId, Provider.FACEBOOK).catch(() => null);
      if (ssoUser) {
        notes.push(
          'A Postmill account was created with Facebook Login for this user. Account deletion is handled on request: email support@postmill.ai quoting this confirmation code.',
        );
        this._logger.warn(`meta data-deletion (${family}): user ${userId} also has a Facebook-login account ${ssoUser.id}`);
      }
    }

    const status: MetaDeletionStatus = {
      code,
      status: 'completed',
      family,
      requestedAt,
      completedAt: new Date().toISOString(),
      channels: integrations.length,
      notes,
    };
    await ioRedis.set(metaDeletionStatusKey(code), JSON.stringify(status), 'EX', DELETION_STATUS_TTL_SECONDS);
    this._logger.log(
      `meta data-deletion (${family}): purged ${integrations.length} channel(s) for user ${userId}, confirmation ${code}`,
    );

    const frontend = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    return {
      url: `${frontend}/integrations/social/meta/data-deletion?code=${code}`,
      confirmation_code: code,
      status,
    };
  }

  async deletionStatus(code: string): Promise<MetaDeletionStatus> {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8,32}$/.test(normalized)) return { code: normalized, status: 'unknown' };
    const raw = await ioRedis.get(metaDeletionStatusKey(normalized));
    if (!raw) return { code: normalized, status: 'unknown' };
    try {
      return JSON.parse(raw) as MetaDeletionStatus;
    } catch {
      return { code: normalized, status: 'unknown' };
    }
  }

  /**
   * Hard-delete what came from the platform (synced comments, analytics,
   * plugs), unpin alert rules, and soft-delete the channel with its
   * credentials and profile scrubbed. Posts are handled by the caller.
   */
  purgeChannelData(org: string, id: string) {
    const where = { organizationId: org, integrationId: id };
    return this._prisma.$transaction([
      this._prisma.plugs.deleteMany({ where }),
      this._prisma.socialComment.deleteMany({ where }),
      this._prisma.postAnalyticsSnapshot.deleteMany({ where }),
      this._prisma.analyticsSnapshot.deleteMany({ where }),
      this._prisma.analyticsAnomaly.deleteMany({ where }),
      this._prisma.analyticsAlertRule.updateMany({ where, data: { integrationId: null } }),
      this._prisma.integration.update({
        where: { id, organizationId: org },
        data: {
          deletedAt: new Date(),
          refreshNeeded: true,
          token: '',
          refreshToken: null,
          tokenExpiration: null,
          picture: null,
          profile: null,
          name: 'Removed (Meta data deletion)',
          additionalSettings: '[]',
          customInstanceDetails: null,
        },
      }),
    ]);
  }

  private _confirmationCode(): string {
    // randomInt is uniform over the alphabet; a modulo over random bytes is biased.
    let code = '';
    for (let i = 0; i < 12; i++) code += CONFIRMATION_ALPHABET[randomInt(CONFIRMATION_ALPHABET.length)];
    return code;
  }

  private async _audit(entry: {
    organizationId: string;
    action: string;
    entity: string;
    entityId?: string;
    entityName?: string;
    details?: string;
  }) {
    try {
      await this._auditService.create(entry);
    } catch (err) {
      this._logger.warn(`Failed to audit ${entry.action}: ${(err as Error).message}`);
    }
  }
}
