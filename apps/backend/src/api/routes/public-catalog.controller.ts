import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PublicCatalogDto } from '@postmill-ai/nestjs-libraries/dtos/providers/public-catalog.dto';
import {
  isPublicCatalogDomain,
  PUBLIC_CATALOG_DOMAINS,
  PublicCatalogService,
} from '@postmill-ai/nestjs-libraries/providers/public-catalog.service';

/**
 * Anonymous integrations catalogue — public (NOT in the authenticatedController
 * group). It is the source of truth the marketing site reads for provider
 * counts, capability matrices, descriptions and icons, so it must work with no
 * session and from any origin (`Access-Control-Allow-Origin: *`; nothing here
 * depends on cookies).
 *
 * Unlike the authenticated `/providers/catalog`, it carries no provider
 * versions, status, credential fields or sunset dates — none of the detail
 * that fingerprints a deployment's exact release.
 */
@ApiTags('Public')
@Controller('/public/integrations')
export class PublicCatalogController {
  constructor(private _catalog: PublicCatalogService) {}

  @Get('/list')
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  @Header('Access-Control-Allow-Origin', '*')
  async list(@Query('domain') domain?: string): Promise<PublicCatalogDto> {
    if (domain === undefined) {
      return this._catalog.build();
    }
    if (!isPublicCatalogDomain(domain)) {
      throw new BadRequestException(
        `Unknown domain "${domain}" — expected one of ${PUBLIC_CATALOG_DOMAINS.join(', ')}`,
      );
    }
    return this._catalog.build(domain);
  }
}
