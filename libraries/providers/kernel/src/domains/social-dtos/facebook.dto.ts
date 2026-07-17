import { IsIn, IsOptional, ValidateIf, IsUrl, Allow } from 'class-validator';

export class FacebookDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsOptional()
  @ValidateIf(p => p.url)
  @IsUrl()
  url?: string;

  @IsIn(['post', 'story'])
  @IsOptional()
  post_type?: 'post' | 'story';
}
