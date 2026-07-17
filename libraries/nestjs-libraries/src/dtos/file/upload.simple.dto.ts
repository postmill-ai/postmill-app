import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class UploadSimpleBodyDto {
  @IsOptional()
  @IsString()
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
}
