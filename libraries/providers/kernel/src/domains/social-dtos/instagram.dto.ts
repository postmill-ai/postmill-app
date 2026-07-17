import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsString,
  ValidateNested,
  IsOptional, Allow } from 'class-validator';

export class Collaborators {
  @IsDefined()
  @IsString()
  label: string;
}
export class InstagramDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsIn(['post', 'story'])
  @IsDefined()
  post_type: 'post' | 'story';

  @IsOptional()
  is_trial_reel?: boolean;

  @IsIn(['MANUAL', 'SS_PERFORMANCE'])
  @IsOptional()
  graduation_strategy?: 'MANUAL' | 'SS_PERFORMANCE';

  @Type(() => Collaborators)
  @ValidateNested({ each: true })
  @IsArray()
  @IsOptional()
  collaborators: Collaborators[];
}
