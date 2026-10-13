import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 6.3 — `/files/import` previously took an inline body type, so the global
 * ValidationPipe (`whitelist` + `forbidNonWhitelisted`) never applied and any
 * field could ride through unbounded. This DTO caps every string and rejects
 * unknown fields, matching the keys the frontend actually sends
 * (url/name/folderId/type/source/downloadLocation/attribution).
 */
export class ImportFromUrlDto {
  @IsString()
  @MaxLength(4096)
  url!: string;

  @IsString()
  @MaxLength(512)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  folderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  downloadLocation?: string;

  @IsOptional()
  @IsObject()
  attribution?: Record<string, unknown>;

  /**
   * Marks the import as an AI Designer intermediate so the library listing
   * hides it and session teardown can purge it. Clients may only set the
   * documented marker shape — `'reference'` for reference-image imports; the
   * `'asset'` stamp and `sessionId` are backend-internal (the asset agent
   * stamps them server-side), never client-controllable metadata.
   */
  @IsOptional()
  @IsIn(['reference'])
  aiDesigner?: 'reference';
}
