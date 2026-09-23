import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  FEDERATION_AUDIENCE,
  FederationService,
} from '@postmill-ai/nestjs-libraries/database/prisma/federation/federation.service';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { User, Organization } from '@prisma/client';
import {
  AuthorizeFederationQueryDto,
  ApproveFederationDto,
} from '@postmill-ai/nestjs-libraries/dtos/federation/authorize-federation.dto';
import { TokenFederationDto } from '@postmill-ai/nestjs-libraries/dtos/federation/token-federation.dto';

@ApiTags('Federation')
@Controller('/.well-known')
export class FederationDiscoveryController {
  constructor(private _federationService: FederationService) {}

  @Get('/postmill-identity')
  @ApiOperation({
    summary: 'Postmill ID discovery document (endpoints, JWKS URI, scopes)',
  })
  discovery() {
    return this._federationService.getDiscoveryDocument();
  }
}

@ApiTags('Federation')
@Controller('/federation')
export class FederationController {
  constructor(private _federationService: FederationService) {}

  @Get('/jwks')
  @ApiOperation({ summary: 'Public JWKS used to verify federation id_tokens' })
  jwks() {
    return this._federationService.getJwks();
  }

  @Get('/authorize')
  @ApiOperation({
    summary: 'Validate a federation authorize request (consent screen metadata)',
  })
  authorize(@Query() query: AuthorizeFederationQueryDto) {
    this._federationService.validateAuthorizeRequest(query.redirect_uri);

    return {
      client: {
        name: 'Postmill Template Store',
        audience: FEDERATION_AUDIENCE,
        redirectUri: query.redirect_uri,
      },
      state: query.state,
    };
  }

  @Post('/token')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Exchange a federation authorization code (public client, PKCE only)',
  })
  token(@Body() body: TokenFederationDto) {
    if (body.grant_type !== 'authorization_code') {
      throw new HttpException(
        { error: 'unsupported_grant_type' },
        HttpStatus.BAD_REQUEST
      );
    }

    return this._federationService.exchangeCode(
      body.code,
      body.redirect_uri,
      body.code_verifier
    );
  }

  @Get('/userinfo')
  @Post('/userinfo')
  @ApiOperation({ summary: 'Scope-gated identity claims for a posf_ access token' })
  async userinfo(@Headers('authorization') authorization?: string) {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
    if (!token || !token.startsWith('posf_')) {
      throw new HttpException(
        { error: 'invalid_token' },
        HttpStatus.UNAUTHORIZED
      );
    }

    const info = await this._federationService.getUserInfo(token);
    if (!info) {
      throw new HttpException(
        { error: 'invalid_token' },
        HttpStatus.UNAUTHORIZED
      );
    }
    return info;
  }
}

@ApiTags('Federation')
@Controller('/federation')
export class FederationAuthorizedController {
  constructor(private _federationService: FederationService) {}

  @Post('/authorize')
  @ApiOperation({ summary: 'Approve or deny a federation consent request' })
  async approveOrDeny(
    @Body() body: ApproveFederationDto,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    this._federationService.validateAuthorizeRequest(body.redirect_uri);

    const redirectUrl = new URL(body.redirect_uri);
    if (body.action === 'deny') {
      redirectUrl.searchParams.set('error', 'access_denied');
      if (body.state) {
        redirectUrl.searchParams.set('state', body.state);
      }
      return { redirect: redirectUrl.toString() };
    }

    const code = await this._federationService.createAuthorizationCode(
      user.id,
      org.id,
      {
        redirectUri: body.redirect_uri,
        codeChallenge: body.code_challenge,
        codeChallengeMethod: body.code_challenge_method,
        nonce: body.nonce,
        scope: body.scope,
      }
    );

    redirectUrl.searchParams.set('code', code);
    if (body.state) {
      redirectUrl.searchParams.set('state', body.state);
    }
    return { redirect: redirectUrl.toString() };
  }
}
