import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UploadSimpleBodyDto {
  @IsOptional()
  @IsString()
  // Multipart bodies carry strings only, so a client with no folder selected can
  // send the literal "undefined"/"null"/"". Normalize to undefined so it resolves
  // to the root folder deliberately instead of silently missing the folder lookup
  // (which also defeats per-folder storage-provider routing).
  @Transform(({ value }) =>
    value === '' || value === 'undefined' || value === 'null' ? undefined : value
  )
  folderId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return false;
    }
    return value === true || value === 'true';
  })
  preventSave?: boolean;

  @IsOptional()
  @IsIn(['design-preview'])
  // System-artifact stamp. Preview thumbnails must be File rows (designs and
  // templates reference them by FK) but are not library content; stamped rows
  // are hidden from the default listing. Client-settable, same trust level as
  // ImportFromUrlDto.aiDesigner='reference' — org-scoped, listing-only.
  internal?: 'design-preview';

  // Stock provenance, matching ImportFromUrlDto (`/files/import`): the locally
  // rasterized stock-icon save rides this endpoint, and CC-BY icon sets need the
  // attribution persisted on the stored File row's metadata.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  @IsOptional()
  @IsObject()
  // Multipart bodies carry strings only, so the client sends attribution as a
  // JSON string; parse it here and let @IsObject reject a malformed payload.
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  })
  attribution?: Record<string, unknown>;
}
