import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
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
}
