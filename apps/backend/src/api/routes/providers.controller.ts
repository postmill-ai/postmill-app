import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import {
  ProviderDomain,
  isProviderDomain,
} from '@gitroom/provider-kernel';
import { SuperAdminGuard } from '@gitroom/backend/services/auth/rbac/super-admin.guard';
import { AuthGuard } from '@gitroom/backend/services/auth/auth.guard';
import { ProviderCatalogService } from '@gitroom/nestjs-libraries/providers/provider-catalog.service';
import { ProviderHealthService } from '@gitroom/nestjs-libraries/providers/provider-health.service';
import { FeaturedProviderService } from '@gitroom/nestjs-libraries/database/prisma/featured-providers/featured-provider.service';
import {
  FeaturedProviderDto,
  FeaturedProviderRemoveDto,
  FeaturedReorderDto,
} from '@gitroom/nestjs-libraries/dtos/providers/featured-provider.dtos';

// PROVIDER_REMEDIATION 3.3: `isProviderDomain` + the domain set are now a single
// source of truth exported from the kernel (`@gitroom/provider-kernel`), shared
// with `featured-provider.service.ts` — no local duplicate that could drift.

// PROVIDER_REMEDIATION 3.3: an invalid `?domain=` must fail closed with a 400 —
// previously an unknown value mapped to `undefined` and returned the full
// cross-domain catalog (fails open / info leak).
function resolveDomainFilter(domain?: string): ProviderDomain | undefined {
  if (domain === undefined || domain === '') return undefined;
  if (!isProviderDomain(domain)) {
    throw new BadRequestException(`Unknown provider domain: ${domain}`);
  }
  return domain;
}

@ApiTags('Providers')
@Controller('/providers')
export class ProvidersController {
  constructor(
    private readonly _catalog: ProviderCatalogService,
  ) {}

  @Get('/catalog')
  @UseGuards(AuthGuard)
  async catalog(@Query('domain') domain?: string) {
    const domainFilter = resolveDomainFilter(domain);
    return this._catalog.buildCatalog(domainFilter);
  }
}

@ApiTags('Admin Providers')
@Controller('/admin/providers')
// PROVIDER_REMEDIATION 3.2 + 6.2: SuperAdminGuard is the class-level structural
// backstop. The redundant `@UseGuards(PoliciesGuard)` was removed — PoliciesGuard is
// already registered as a global APP_GUARD (it was running twice per request).
@UseGuards(SuperAdminGuard)
export class AdminProvidersController {
  constructor(
    private readonly _health: ProviderHealthService,
    private readonly _featured: FeaturedProviderService,
  ) {}

  // Platform-wide provider admin is super-admin-only. SuperAdminGuard is the class-level
  // structural backstop, and each handler asserts isSuperAdmin explicitly (the same pattern
  // as AnnouncementsController / StorageController / AdminDefaultsController).
  private _assertSuperAdmin(user: User) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 403);
    }
  }

  @Get('/health')
  health(@GetUserFromRequest() user: User, @Query('domain') domain?: string) {
    this._assertSuperAdmin(user);
    return this._health.buildHealth(resolveDomainFilter(domain));
  }

  // ── Featured providers (super-admin curation) ──

  @Get('/featured')
  listFeatured(@GetUserFromRequest() user: User, @Query('domain') domain?: string) {
    this._assertSuperAdmin(user);
    return this._featured.list(domain);
  }

  @Post('/featured')
  upsertFeatured(@GetUserFromRequest() user: User, @Body() body: FeaturedProviderDto) {
    this._assertSuperAdmin(user);
    return this._featured.upsert(body.domain, body.providerId, body.sortOrder);
  }

  @Put('/featured/reorder')
  reorderFeatured(@GetUserFromRequest() user: User, @Body() body: FeaturedReorderDto) {
    this._assertSuperAdmin(user);
    return this._featured.reorder(body.domain, body.entries);
  }

  @Delete('/featured')
  removeFeatured(@GetUserFromRequest() user: User, @Body() body: FeaturedProviderRemoveDto) {
    this._assertSuperAdmin(user);
    return this._featured.remove(body.domain, body.providerId);
  }
}

// Re-export the DTOs from the shared DTO package so existing imports keep working.
export {
  FeaturedProviderDto,
  FeaturedProviderRemoveDto,
  FeaturedReorderDto,
} from '@gitroom/nestjs-libraries/dtos/providers/featured-provider.dtos';
