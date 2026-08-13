import { IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class UploadServerBodyDto {
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
}
