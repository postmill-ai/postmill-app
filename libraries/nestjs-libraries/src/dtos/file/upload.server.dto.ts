import { IsOptional, IsString } from 'class-validator';

export class UploadServerBodyDto {
  @IsOptional()
  @IsString()
  folderId?: string;
}
