import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import * as crypto from 'crypto';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { isAllowedReturnUrl } from '@gitroom/nestjs-libraries/security/return-url.validator';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { ApiKeysService } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api-keys.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

@ApiTags('Enterprise')
@Controller('/enterprise')
export class EnterpriseController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _organizationService: OrganizationService,
    private _apiKeysService: ApiKeysService,
    private _integrationService: IntegrationService,
    private _postsService: PostsService
  ) {}

  @Post('/create-user')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async createUser(@Body('params') params: string) {
    try {
      const { id, name, saasName, email } = AuthService.verifyJWT(params) as {
        id: string;
        name: string;
        email: string;
        saasName: string;
      };

      try {
        return await this._organizationService.createMaxUser(
          id,
          name,
          saasName,
          email
        );
      } catch (err) {
        return { create: false };
      }
    } catch (err) {
      return { success: false };
    }
  }

  @Post('/url')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async redirectParams(@Body('params') params: string) {
    try {
      const load = AuthService.verifyJWT(params) as {
        redirectUrl: string;
        apiKey: string;
        refreshId?: string;
        provider: string;
        webhookUrl: string;
      };

      if (!load || !load.redirectUrl || !load.apiKey || !load.provider) {
        return;
      }

      const hash = crypto.createHash('sha256').update(load.apiKey).digest('hex');
      const apiKey = await this._apiKeysService.findActiveByHash(hash);
      const org = apiKey?.organization || null;

      if (!org) {
        throw new Error('Organization not found');
      }

      if (
        !this._integrationManager
          .getAllowedSocialsIntegrations()
          .includes(load.provider)
      ) {
        throw new Error('Integration not allowed');
      }

      const integrationProvider = await this._integrationManager.getSocialIntegration(
        load.provider
      );

      const clientInformation = await this._integrationManager.requireClientInformation(
        load.provider,
        org.id
      );

      const { codeVerifier, state, url } =
        await integrationProvider.generateAuthUrl(clientInformation);

      if (load.refreshId) {
        await ioRedis.set(`refresh:${state}`, load.refreshId, 'EX', 3600);
      }

      await ioRedis.set(`webhookUrl:${state}`, load.webhookUrl, 'EX', 3600);
      if (!isAllowedReturnUrl(load.redirectUrl)) {
        throw new Error('Invalid redirect URL');
      }
      await ioRedis.set(`redirect:${state}`, load.redirectUrl, 'EX', 3600);
      await ioRedis.set(`organization:${state}`, org.id, 'EX', 3600);
      await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);

      return url;
    } catch (err) {}
  }

  @Post('/delete-channel')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async deleteChannel(@Body('params') params: string) {
    try {
      const load = AuthService.verifyJWT(params) as {
        apiKey: string;
        id: string;
      };

      if (!load || !load.apiKey || !load.id) {
        return { success: false };
      }

      const hash = crypto.createHash('sha256').update(load.apiKey).digest('hex');
      const apiKey = await this._apiKeysService.findActiveByHash(hash);
      const org = apiKey?.organization || null;

      if (!org) {
        return { success: false };
      }

      const isTherePosts = await this._integrationService.getPostsForChannel(
        org.id,
        load.id
      );
      if (isTherePosts.length) {
        for (const post of isTherePosts) {
          this._postsService.deletePost(org.id, post.group).catch(() => {});
        }
      }

      await this._integrationService.deleteChannel(org.id, load.id);
      return { success: true };
    } catch (err) {
      return { success: false };
    }
  }
}
