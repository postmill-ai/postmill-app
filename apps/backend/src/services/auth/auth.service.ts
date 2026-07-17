import { Injectable } from '@nestjs/common';
import { Provider, User, UserOrganization } from '@prisma/client';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { ProvidersManager } from '@gitroom/backend/services/auth/providers/providers.manager';
import dayjs from 'dayjs';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { ForgotReturnPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { OAuthLinkQueryDto } from '@gitroom/nestjs-libraries/dtos/auth/oauth-link-query.dto';
import { NewsletterService } from '@gitroom/nestjs-libraries/newsletter/newsletter.service';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private _userService: UsersService,
    private _organizationService: OrganizationService,
    private _notificationService: NotificationService,
    private _providerManager: ProvidersManager
  ) {}

  private generateRefreshToken(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async createSession(userId: string, ip: string, userAgent: string) {
    const refreshToken = this.generateRefreshToken();
    const tokenHash = this.hashToken(refreshToken);

    await this._userService.createSession({
      userId,
      tokenHash,
      expiresAt: dayjs().add(30, 'day').toDate(),
      ip,
      userAgent,
    });

    return refreshToken;
  }

  private async handleProviderPicture(
    userId: string,
    email: string,
    pictureUrl?: string | null
  ) {
    let avatarUrl: string | null = null;

    if (pictureUrl) {
      avatarUrl = pictureUrl;
    } else if (email) {
      const md5 = crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex');
      avatarUrl = `https://www.gravatar.com/avatar/${md5}?d=404&s=200`;
    }

    if (avatarUrl) {
      await this._userService.updateUserAvatar(userId, avatarUrl);
    }
  }

  async canRegister(provider: string) {
    if (
      process.env.DISABLE_REGISTRATION !== 'true' ||
      provider === Provider.GENERIC
    ) {
      return true;
    }

    return (await this._organizationService.getCount()) === 0;
  }

  async routeAuth(
    provider: Provider,
    body: CreateOrgUserDto | LoginUserDto,
    ip: string,
    userAgent: string,
    addToOrg?: boolean | { orgId: string; role: 'USER' | 'ADMIN'; id: string; roleId?: string }
  ) {
    let user: User;
    let addedOrg: UserOrganization | false = false;

    if (provider === Provider.LOCAL) {
      if (process.env.DISALLOW_PLUS && body.email.includes('+')) {
        throw new Error('Email with plus sign is not allowed');
      }
      if (body instanceof CreateOrgUserDto) {
        body.email = body.email.toLowerCase();
      }
      const existingUser = await this._userService.getUserByEmail(body.email);
      if (body instanceof CreateOrgUserDto) {
        if (existingUser) {
          throw new Error('Email already exists');
        }

        if (!(await this.canRegister(provider))) {
          throw new Error('Registration is disabled');
        }

        const create = await this._organizationService.createOrgAndUser(
          body,
          ip,
          userAgent
        );

        addedOrg =
          addToOrg && typeof addToOrg !== 'boolean'
            ? await this._organizationService.addUserToOrg(
                create.users[0].user.id,
                addToOrg.id,
                addToOrg.orgId,
                addToOrg.role,
                addToOrg.roleId,
              )
            : false;

        user = create.users[0].user;

        // Set Gravatar avatar for local email signups.
        await this.handleProviderPicture(user.id, user.email, null);

        const jwt = await this.jwt(user);
        const refreshToken = await this.createSession(user.id, ip, userAgent);

        await this._notificationService.sendEmail(
          body.email,
          'Activate your account',
          `Click <a href="${process.env.FRONTEND_URL}/auth/activate/${jwt}">here</a> to activate your account`
        );
        return { addedOrg, jwt, refreshToken };
      }

      if (!existingUser || !AuthChecker.comparePassword(body.password, existingUser.password)) {
        throw new Error('Invalid user name or password');
      }

      if (!existingUser.activated) {
        throw new Error('User is not activated');
      }

      user = existingUser;
    } else {
      user = await this.loginOrRegisterProvider(
        provider,
        body as CreateOrgUserDto,
        ip,
        userAgent
      );
    }

    addedOrg =
      addToOrg && typeof addToOrg !== 'boolean'
        ? await this._organizationService.addUserToOrg(
            user.id,
            addToOrg.id,
            addToOrg.orgId,
            addToOrg.role,
            addToOrg.roleId,
          )
        : false;

    const jwt = await this.jwt(user);
    const refreshToken = await this.createSession(user.id, ip, userAgent);

    return { addedOrg, jwt, refreshToken };
  }

  public getOrgFromCookie(cookie?: string) {
    if (!cookie) {
      return false;
    }

    try {
      const getOrg: any = AuthChecker.verifyJWT(cookie);
      if (dayjs(getOrg.timeLimit).isBefore(dayjs())) {
        return false;
      }

      return getOrg as {
        email: string;
        role: 'USER' | 'ADMIN';
        roleId?: string;
        orgId: string;
        id: string;
      };
    } catch (err) {
      return false;
    }
  }

  private async loginOrRegisterProvider(
    provider: Provider,
    body: CreateOrgUserDto,
    ip: string,
    userAgent: string
  ) {
    const providerInstance = this._providerManager.getProvider(provider);
    const providerUser = await providerInstance.getUser(body.providerToken);

    if (!providerUser) {
      throw new Error('Invalid provider token');
    }

    const user = await this._userService.getUserByProvider(
      providerUser.id,
      provider
    );
    if (user) {
      return user;
    }

    if (!(await this.canRegister(provider))) {
      throw new Error('Registration is disabled');
    }

    const create = await this._organizationService.createOrgAndUser(
      {
        company: body.company,
        email: providerUser.email,
        password: '',
        provider,
        providerId: providerUser.id,
        datafast_visitor_id: body.datafast_visitor_id,
        name: providerUser.name || body.name || undefined,
        lastName: body.lastName || undefined,
      },
      ip,
      userAgent
    );

    this._track('register', providerUser.email, body.datafast_visitor_id).catch(
      (err) => {}
    );

    await NewsletterService.register(providerUser.email);

    try {
      if (providerInstance?.postRegistration) {
        await providerInstance.postRegistration(body.providerToken, create.id);
      }
    } catch (err) {
      // Don't fail registration if postRegistration fails
    }

    // Handle provider picture
    const newUser = create.users[0].user;
    const pictureUrl = providerUser.picture ?? null;
    await this.handleProviderPicture(newUser.id, newUser.email, pictureUrl);

    return newUser;
  }

  private async _track(
    name: string,
    email: string,
    datafast_visitor_id: string
  ) {
    if (email && datafast_visitor_id && process.env.DATAFAST_API_KEY) {
      try {
        // Fixed public host, but routed through safeFetch to align with the outbound-HTTP
        // standard (SSRF dispatcher + per-hop redirect re-validation).
        await safeFetch('https://datafa.st/api/v1/goals', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.DATAFAST_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datafast_visitor_id: datafast_visitor_id,
            name: name,
            metadata: {
              email,
            },
          }),
        });
      } catch (err) {}
    }
  }

  async forgot(email: string) {
    const user = await this._userService.getUserByEmail(email);
    if (!user || user.providerName !== Provider.LOCAL) {
      return false;
    }

    const resetValues = AuthChecker.signJWT({
      id: user.id,
      expires: dayjs().add(20, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
    });

    await this._notificationService.sendEmail(
      user.email,
      'Reset your password',
      `You have requested to reset your passsord. <br />Click <a href="${process.env.FRONTEND_URL}/auth/forgot/${resetValues}">here</a> to reset your password<br />The link will expire in 20 minutes`
    );
  }

  forgotReturn(body: ForgotReturnPasswordDto) {
    const user = AuthChecker.verifyJWT(body.token) as {
      id: string;
      expires: string;
    };
    if (dayjs(user.expires).isBefore(dayjs())) {
      return false;
    }

    return this._userService.updatePassword(user.id, body.password);
  }

  async activate(code: string, tracking: string) {
    const user = AuthChecker.verifyJWT(code) as {
      id: string;
      activated: boolean;
      email: string;
    };
    if (user.id && !user.activated) {
      const getUserAgain = await this._userService.getUserByEmail(user.email);
      if (getUserAgain.activated) {
        return false;
      }
      await this._userService.activateUser(user.id);
      user.activated = true;
      this._track('register', user.email, tracking).catch((err) => {});
      await NewsletterService.register(user.email);
      return this.jwt(user);
    }

    return false;
  }

  async resendActivationEmail(email: string) {
    const user = await this._userService.getUserByEmail(email);

    if (!user) {
      throw new Error('User not found');
    }

    if (user.activated) {
      throw new Error('Account is already activated');
    }

    const jwt = await this.jwt(user);

    await this._notificationService.sendEmail(
      user.email,
      'Activate your account',
      `Click <a href="${process.env.FRONTEND_URL}/auth/activate/${jwt}">here</a> to activate your account`
    );

    return true;
  }

  oauthLink(provider: string, query?: OAuthLinkQueryDto) {
    const providerInstance = this._providerManager.getProvider(provider);
    return providerInstance.generateLink(query);
  }

  async checkExists(provider: string, code: string, redirectUri?: string) {
    const providerInstance = this._providerManager.getProvider(provider);
    const token = await providerInstance.getToken(code, redirectUri);
    const user = await providerInstance.getUser(token);
    if (!user) {
      throw new Error('Invalid user');
    }
    const checkExists = await this._userService.getUserByProvider(
      user.id,
      provider as Provider
    );
    if (checkExists) {
      const jwt = await this.jwt(checkExists);
      return { jwt, userId: checkExists.id };
    }

    return { token, userId: undefined as string | undefined };
  }

  async refreshAccessToken(refreshToken: string, ip: string, userAgent: string) {
    const tokenHash = this.hashToken(refreshToken);
    const session = await this._userService.findSessionByTokenHash(tokenHash);

    if (!session) {
      // Reuse of a rotated-out token revokes the live session it belonged to.
      const rotatedSession =
        await this._userService.findSessionByPreviousTokenHash(tokenHash);
      if (rotatedSession && !rotatedSession.revokedAt) {
        await this._userService.revokeSession(
          rotatedSession.userId,
          rotatedSession.id
        );
        throw new Error('Refresh token reuse detected — session revoked');
      }
      throw new Error('Invalid refresh token');
    }

    if (session.revokedAt) {
      throw new Error('Refresh token has been revoked');
    }

    if (session.expiresAt < new Date()) {
      await this._userService.revokeSession(session.userId, session.id);
      throw new Error('Refresh token has expired');
    }

    // Rotate: generate new token, update session
    const newRefreshToken = this.generateRefreshToken();
    const newTokenHash = this.hashToken(newRefreshToken);

    await this._userService.rotateSessionToken(
      session.userId,
      session.id,
      newTokenHash,
      session.tokenHash,
      ip,
      userAgent
    );

    // Issue new JWT
    const user = await this._userService.getUserById(session.userId);
    if (!user) {
      throw new Error('User not found');
    }

    return { jwt: await this.jwt(user), refreshToken: newRefreshToken };
  }

  async getUserSessions(userId: string) {
    return this._userService.getUserSessions(userId);
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this._userService.getSessionById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error('Session not found');
    }
    await this._userService.revokeSession(userId, sessionId);
  }

  async revokeAllSessions(userId: string, currentTokenHash?: string) {
    if (currentTokenHash) {
      return this._userService.revokeAllSessionsExcept(userId, currentTokenHash);
    }
    return this._userService.revokeAllUserSessions(userId);
  }

  async getSessionByTokenHash(tokenHash: string) {
    return this._userService.findSessionByTokenHash(tokenHash);
  }

  private async jwt(user: Partial<User> & Pick<User, 'id'>) {
    if (user.password) {
      delete user.password;
    }
    return AuthChecker.signJWT(user);
  }
}
