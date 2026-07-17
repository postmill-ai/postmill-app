import { IsOptional, IsString } from 'class-validator';

export class SearchFilesQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  folderId?: string;
}
