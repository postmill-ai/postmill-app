import { Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { Organization, User } from '@prisma/client';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

/**
 * Lightweight membership row returned by org-resolution queries.
 * Mirrors the selected fields in OrganizationRepository.getOrgsByUserId
 * and getUserOrg — enough to compute roleKey and filter disabled members.
 */
export interface ResolvedOrgMembership {
  disabled: boolean;
  roleId?: string | null;
  roleRef?: { key: string } | null;
  // getUserOrg also selects id/userId; include them loosely for shape parity.
  id?: string;
  userId?: string;
}

export type ResolvedOrg = Organization & { users: ResolvedOrgMembership[] };

export interface AuthContextInput {
  jwt: string;
  showOrgId?: string;
  impersonateOrgUserId?: string;
}

export interface ResolvedAuthContext {
  user: User;
  org: ResolvedOrg;
  isSuperAdmin: boolean;
  roleKey: string;
  /**
   * JWT expiry timestamp in seconds, captured during verification so HTTP
   * transports can perform sliding re-issue without verifying twice.
   */
  expiresAt?: number;
  /**
   * True when the caller is a super-admin impersonating another user/org.
   * HTTP middleware uses this to skip sliding JWT re-issue (the original
   * requester's token must not be replaced with the impersonated user's).
   */
  impersonated: boolean;
}

export type AuthContextResult =
  | { ok: true; context: ResolvedAuthContext }
  | {
      ok: false;
      reason: 'missing_auth' | 'invalid_jwt' | 'user_not_found' | 'no_org';
    };

/**
 * Framework-neutral auth-context resolution.
 *
 * Used by both HTTP middleware and the AI Designer socket gateway so that
 * JWT → user → org selection stays structurally in sync across transports.
 * Transport-specific concerns (sliding JWT re-issue, CSRF, cookie clearing)
 * stay outside this service.
 */
@Injectable()
export class AuthContextResolver {
  constructor(
    private _users: UsersService,
    private _orgs: OrganizationService
  ) {}

  async resolve(input: AuthContextInput): Promise<AuthContextResult> {
    if (!input.jwt) {
      return { ok: false, reason: 'missing_auth' };
    }

    let payload: (User & { exp?: number }) | null;
    try {
      payload = AuthService.verifyJWT(input.jwt) as (User & { exp?: number }) | null;
    } catch {
      return { ok: false, reason: 'invalid_jwt' };
    }

    if (!payload?.id) {
      return { ok: false, reason: 'invalid_jwt' };
    }

    let user: User | null = await this._users.getUserById(payload.id);
    if (!user || !user.activated) {
      return { ok: false, reason: 'user_not_found' };
    }

    let isSuperAdmin = !!user.isSuperAdmin;
    let org: ResolvedOrg | undefined;
    let impersonated = false;

    if (isSuperAdmin && input.impersonateOrgUserId) {
      const impersonatedRecord = await this._orgs.getUserOrg(input.impersonateOrgUserId);
      if (impersonatedRecord) {
        user = impersonatedRecord.user as User;
        user.isSuperAdmin = true;
        delete user.password;
        isSuperAdmin = true;
        impersonated = true;

        impersonatedRecord.organization.users =
          impersonatedRecord.organization.users?.filter((f) => f.userId === user.id) ?? [];
        org = impersonatedRecord.organization as ResolvedOrg;
      }
    }

    if (!org) {
      const orgs = (
        await this._orgs.getOrgsByUserId(user.id)
      ).filter((o) => !o.users?.[0]?.disabled) as ResolvedOrg[];

      if (orgs.length === 0) {
        return { ok: false, reason: 'no_org' };
      }

      org = orgs.find((o) => o.id === input.showOrgId) ?? orgs[0];
    }

    const roleKey =
      org.users?.[0]?.roleRef?.key ?? (org.users?.[0] as any)?.role ?? 'member';

    delete user.password;

    return {
      ok: true,
      context: {
        user,
        org,
        isSuperAdmin,
        roleKey,
        expiresAt: payload.exp,
        impersonated,
      },
    };
  }
}
