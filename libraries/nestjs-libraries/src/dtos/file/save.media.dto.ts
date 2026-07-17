import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class SaveMediaDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @MaxLength(2048)
  @Matches(/^https?:\/\/.+|^\/[^\x00\r\n]*$/, {
    message: 'path must be a URL or an absolute upload path',
  })
  path: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalName?: string;

  @IsOptional()
  @IsString()
  folderId?: string;
}
