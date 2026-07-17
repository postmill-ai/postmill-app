import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { sign } from 'jsonwebtoken';
import { Organization, User } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { Response, Request } from 'express';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import {
  pricing,
  SELF_HOST_PLAN,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

import { ApiTags } from '@nestjs/swagger';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { CampaignsService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.service';
import { DeletionService } from '@gitroom/nestjs-libraries/database/prisma/users/deletion.service';
import { DataExportService } from '@gitroom/nestjs-libraries/database/prisma/users/data-export.service';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';

import { ChangePasswordDto } from '@gitroom/nestjs-libraries/dtos/users/change-password.dto';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import crypto from 'crypto';

@ApiTags('User')
@Controller('/user')
export class UsersController {
  private readonly _logger = new Logger(UsersController.name);
  constructor(
    private _subscriptionService: SubscriptionService,
    private _stripeService: StripeService,
    private _authService: AuthService,
    private _orgService: OrganizationService,
    private _userService: UsersService,
    private _campaignsService: CampaignsService,
    private _trackService: TrackService,
    private _auditService: AuditService,
    private _deletionService: DeletionService,
    private _dataExportService: DataExportService
  ) {}
  @Get('/agent-media-sso')
  async getAgentMediaSsoUrl(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    if (!process.env.AGENT_MEDIA_SSO_KEY) {
      // Degrade gracefully when the optional integration isn't configured (#11):
      // the client checks `data.url` and no-ops on null, so a 200 + null URL avoids
      // a spurious 400/console error instead of throwing.
      return { url: null };
    }

    const token = sign(
      { id: organization.id, displayName: organization.name },
      process.env.AGENT_MEDIA_SSO_KEY
    );

    return { url: `https://agent-media.ai/sso/${token}` };
  }

  @Get('/self')
  async getSelf(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Req() req: Request
  ) {
    if (!organization) {
      throw new HttpForbiddenException();
    }

    const impersonate = req.cookies.impersonate || req.headers.impersonate;
    const profile = await this._userService.getProfileByUserId(user.id);
    const org = organization as any;
    // @ts-ignore
    return {
      ...user,
      orgId: organization.id,
      // @ts-ignore
      totalChannels: !process.env.STRIPE_PUBLISHABLE_KEY
        ? 10000
        : org?.subscription?.totalChannels || pricing.STARTER.channel,
      // @ts-ignore
      tier:
        org?.subscription?.subscriptionTier ||
        (!process.env.STRIPE_PUBLISHABLE_KEY ? SELF_HOST_PLAN : 'STARTER'),
      // @ts-ignore
      role: org?.users[0]?.roleId,
      // @ts-ignore
      isLifetime: !!org?.subscription?.isLifetime,
      admin: !!user.isSuperAdmin,
      impersonate: !!impersonate,
      isTrailing: !process.env.STRIPE_PUBLISHABLE_KEY ? false : organization?.isTrailing,
      allowTrial: organization?.allowTrial,
      streakSince: organization?.streakSince || null,
      setupCompleted: !!organization?.setupCompletedAt,
      profile: profile ? {
        name: profile.name,
        lastName: profile.lastName,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        timezone: profile.timezone,
        pictureId: profile.pictureId,
        picture: profile.picture || null,
      } : null,
    };
  }

  @Get('/personal')
  async getPersonalInformation(@GetUserFromRequest() user: User) {
    return this._userService.getPersonal(user.id);
  }

  @Get('/impersonate')
  async getImpersonate(
    @GetUserFromRequest() user: User,
    @Query('name') name: string
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return this._userService.getImpersonateUser(name);
  }

  @Post('/impersonate')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async setImpersonate(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Body('id') id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    response.cookie('impersonate', id, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      // Short-lived impersonation session (B5): 24h, not the 365-day cookie.
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24),
    });

    // Audit the privileged action (B4): actor super-admin + impersonated target + org.
    try {
      await this._auditService.create({
        organizationId: organization.id,
        userId: user.id,
        action: 'user.impersonate',
        entity: 'user',
        entityId: id,
        details: JSON.stringify({ targetUserId: id, actorUserId: user.id }),
      });
    } catch (err) {
      this._logger.warn(`Failed to audit impersonation: ${(err as any)?.message}`);
    }

    if (process.env.NODE_ENV === 'development' && process.env.NOT_SECURED) {
      response.header('impersonate', id);
    }
  }

  @Post('/personal')
  async changePersonal(
    @GetUserFromRequest() user: User,
    @Body() body: UserDetailDto
  ) {
    return this._userService.changePersonal(user.id, body);
  }

  @Post('/change-password')
  async changePassword(
    @GetUserFromRequest() user: User,
    @Body() body: ChangePasswordDto
  ) {
    await this._userService.changePassword(user.id, body.currentPassword, body.newPassword);
    return { success: true };
  }

  @Get('/subscription')
  async getSubscription(@GetOrgFromRequest() organization: Organization) {
    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organization.id
      );

    return subscription ? { subscription } : { subscription: undefined };
  }

  @Get('/subscription/tiers')
  // Pricing tiers are public, identical for every user — gating on ADMIN made the
  // Billing page 401 for non-admins (#20). Keep auth-only (no per-section policy).
  async tiers() {
    return this._stripeService.getPackages();
  }

  @Post('/join-org')
  async joinOrg(
    @GetUserFromRequest() user: User,
    @Body('org') org: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const getOrgFromCookie = this._authService.getOrgFromCookie(org);

    if (!getOrgFromCookie) {
      return response.status(200).json({ id: null });
    }

    const addedOrg = await this._orgService.addUserToOrg(
      user.id,
      getOrgFromCookie.id,
      getOrgFromCookie.orgId,
      getOrgFromCookie.role,
      getOrgFromCookie.roleId,
    );

    response.status(200).json({
      id: typeof addedOrg !== 'boolean' ? addedOrg.organizationId : null,
    });
  }

  @Get('/organizations')
  async getOrgs(@GetUserFromRequest() user: User) {
    // Guard `users[0]`: an org row with an empty `users` relation would throw
    // here → 500 → the frontend org selector receives a non-array error body
    // and crashes the whole tree (white screen on every page). Treat a missing
    // membership row as not-disabled rather than 500ing.
      return (await this._orgService.getOrgsByUserId(user.id)).filter(
      (f) => !f.users?.[0]?.disabled
    );
  }

  @Post('/change-org')
  changeOrg(
    @Body('id') id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    response.cookie('showorg', id, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NODE_ENV === 'development' && process.env.NOT_SECURED) {
      response.header('showorg', id);
    }

    response.status(200).send();
  }

  @Post('/logout')
  async logout(
    @GetUserFromRequest() user: User,
    @Res({ passthrough: true }) response: Response
  ) {
    await this._authService.revokeAllSessions(user.id);
    response.header('logout', 'true');
    response.cookie('auth', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.cookie('showorg', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.cookie('impersonate', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.cookie('refresh_token', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.status(200).send();
  }

  // Read-only team-member profile. Tenant-guarded: only resolves a user who is a
  // member of the requester's org (getMemberProfile returns null otherwise).
  @Get('/profile/:userId')
  async memberProfile(
    @GetOrgFromRequest() org: Organization,
    @Param('userId') userId: string
  ) {
    const member = await this._orgService.getMemberProfile(org.id, userId);
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    const profile = member.user.profile;
    const fullName = [profile?.name, profile?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const campaignsCreated = await this._campaignsService.countCreatedBy(
      org.id,
      userId
    );
    // NOTE: email is deliberately omitted — unlike the policy-gated team list,
    // this route is available to any org member (via the "Created by" link), so
    // it must not broaden PII (email) visibility past the team-list role boundary.
    return {
      id: member.user.id,
      name: fullName || member.user.email,
      bio: profile?.bio || null,
      avatarUrl: profile?.avatarUrl || profile?.picture?.path || null,
      role: member.roleRef?.name || member.roleRef?.key || null,
      joinedAt: member.createdAt,
      campaignsCreated,
    };
  }

  @Get('/sessions')
  async getSessions(@GetUserFromRequest() user: User) {
    return this._authService.getUserSessions(user.id);
  }

  @Post('/sessions/:id/revoke')
  async revokeSession(
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    await this._authService.revokeSession(user.id, id);
    return { success: true };
  }

  @Post('/sessions/revoke-all')
  async revokeAllSessions(
    @GetUserFromRequest() user: User,
    @Req() req: Request
  ) {
    const refreshToken = req.cookies?.refresh_token;
    let currentTokenHash: string | undefined;
    if (refreshToken) {
      currentTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    }
    await this._authService.revokeAllSessions(user.id, currentTokenHash || '');
    return { success: true };
  }

  @Post('/t')
  async trackEvent(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @GetUserFromRequest() user: User,
    @RealIP() ip: string,
    @UserAgent() userAgent: string,
    @Body()
    body: { tt: TrackEnum; fbclid: string; additional: Record<string, any> }
  ) {
    const uniqueId = req?.cookies?.track || makeId(10);
    const fbclid = req?.cookies?.fbclid || body.fbclid;
    await this._trackService.track(
      uniqueId,
      ip,
      userAgent,
      body.tt,
      body.additional,
      fbclid,
      user
    );
    if (!req.cookies.track) {
      res.cookie('track', uniqueId, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
          ? {
              secure: true,
              httpOnly: true,
              sameSite: 'none',
            }
          : {}),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });
    }

    res.status(200).json({
      track: uniqueId,
    });
  }

  // GDPR data-access export (I2): the requesting user's own identity/profile + their
  // current org's posts/comments/files metadata. Auth-only + throttled.
  @Get('/me/export')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async exportMyData(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!organization) {
      throw new HttpForbiddenException();
    }
    const data = await this._dataExportService.exportUserData(
      user.id,
      organization.id
    );
    res.header(
      'Content-Disposition',
      `attachment; filename="postmill-export-${user.id}.json"`
    );
    return data;
  }

  // GDPR erasure (I1): self-service account deletion. Deletes the user, the orgs they
  // solely own, and all owned children. Auth-only (self) + tight throttle.
  @Delete('/me')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async deleteMe(
    @GetUserFromRequest() user: User,
    @Res({ passthrough: true }) response: Response
  ) {
    await this._deletionService.deleteUser(user.id);

    // Clear the auth/session cookies — the account no longer exists.
    for (const name of ['auth', 'showorg', 'impersonate', 'refresh_token']) {
      response.cookie(name, '', {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
          ? { secure: true, httpOnly: true, sameSite: 'none' }
          : {}),
        maxAge: -1,
        expires: new Date(0),
      });
    }
    response.header('logout', 'true');
    return { success: true };
  }
}
