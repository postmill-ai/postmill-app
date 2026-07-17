import { IsOptional, IsString } from 'class-validator';

export class SaveUrlDto {
  @IsString()
  url!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  folderId?: string | null;
}
