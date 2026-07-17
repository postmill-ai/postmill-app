import { IsOptional, IsString, IsUrl } from 'class-validator';

export class GenerateAvatarDto {
  @IsString()
  script: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  imageUrl?: string;
}
