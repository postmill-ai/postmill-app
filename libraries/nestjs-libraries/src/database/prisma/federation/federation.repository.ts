import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class FederationRepository {
  constructor(
    private _instanceIdentity: PrismaRepository<'instanceIdentity'>,
    private _federationGrant: PrismaRepository<'federationGrant'>
  ) {}

  getIdentity() {
    return this._instanceIdentity.model.instanceIdentity.findFirst();
  }

  createIdentity(data: {
    kid: string;
    publicJwk: object;
    privateKeyEnc: string;
  }) {
    return this._instanceIdentity.model.instanceIdentity.create({ data });
  }

  upsertGrant(data: {
    userId: string;
    organizationId: string;
    authorizationCode: string;
    codeExpiresAt: Date;
    redirectUri: string;
    codeChallenge?: string;
    codeChallengeMethod?: string | null;
    nonce?: string;
    scope?: string;
  }) {
    return this._federationGrant.model.federationGrant.upsert({
      where: {
        userId_organizationId: {
          userId: data.userId,
          organizationId: data.organizationId,
        },
      },
      create: {
        userId: data.userId,
        organizationId: data.organizationId,
        authorizationCode: data.authorizationCode,
        codeExpiresAt: data.codeExpiresAt,
        redirectUri: data.redirectUri,
        codeChallenge: data.codeChallenge,
        codeChallengeMethod: data.codeChallengeMethod,
        nonce: data.nonce,
        scope: data.scope,
      },
      update: {
        authorizationCode: data.authorizationCode,
        codeExpiresAt: data.codeExpiresAt,
        redirectUri: data.redirectUri,
        codeChallenge: data.codeChallenge,
        codeChallengeMethod: data.codeChallengeMethod,
        nonce: data.nonce,
        scope: data.scope,
        accessToken: null,
        tokenExpiresAt: null,
        revokedAt: null,
      },
    });
  }

  private identityIncludes() {
    return {
      organization: true,
      user: {
        include: {
          profile: {
            include: {
              picture: true,
            },
          },
          organizations: {
            include: {
              roleRef: true,
            },
          },
        },
      },
    } as const;
  }

  findByCode(hashedCode: string) {
    return this._federationGrant.model.federationGrant.findFirst({
      where: {
        authorizationCode: hashedCode,
        revokedAt: null,
      },
      include: this.identityIncludes(),
    });
  }

  markCodeExchanged(
    id: string,
    data: { accessToken: string; tokenExpiresAt: Date }
  ) {
    return this._federationGrant.model.federationGrant.update({
      where: { id },
      data: {
        authorizationCode: null,
        codeExpiresAt: null,
        accessToken: data.accessToken,
        tokenExpiresAt: data.tokenExpiresAt,
      },
    });
  }

  findByAccessToken(hashedToken: string) {
    return this._federationGrant.model.federationGrant.findFirst({
      where: {
        accessToken: hashedToken,
        revokedAt: null,
        // Fail closed on expiry, same rule as OAuthRepository.findByAccessToken:
        // a null tokenExpiresAt is treated as expired.
        tokenExpiresAt: { gt: new Date() },
      },
      include: this.identityIncludes(),
    });
  }

  getGrantsForUser(userId: string) {
    return this._federationGrant.model.federationGrant.findMany({
      where: {
        userId,
        revokedAt: null,
        accessToken: { not: null },
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async revoke(userId: string, grantId: string) {
    // updateMany so an unknown or foreign id yields count=0 (mapped to a 404
    // by the service) instead of a Prisma P2025 surfacing as a 500.
    const { count } = await this._federationGrant.model.federationGrant.updateMany(
      {
        where: {
          id: grantId,
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      }
    );
    return count;
  }
}
