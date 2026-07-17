import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for `POST /integrations/provider/:id/connect` (the two-step
 * "select a page" connect flow). The frontend spreads the OAuth-callback
 * query params (`...modifiedParams`/`searchParams` — `code`, `refresh`,
 * `device_id`, …) alongside the page-selection fields below, so the exact
 * top-level key set is provider-dependent and not fully enumerable.
 *
 * Only the page-selection fields here are read downstream
 * (`IntegrationService.saveProviderPage` → `provider.fetchPageInformation`).
 * They are validated + length-bounded; the extra OAuth params are stripped
 * (not rejected) by the route's `whitelist: true, forbidNonWhitelisted: false`
 * pipe — the global `forbidNonWhitelisted: true` pipe would otherwise 400 a
 * legitimate connect because of those provider-specific callback params.
 */
export class ConnectProviderDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  page?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  pageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  locationName?: string;
}
