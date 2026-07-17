import {
  IsDefined,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested, Allow } from 'class-validator';
import { MediaDto } from './media.dto';
import { Type } from 'class-transformer';

export class WordpressDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsString()
  @MinLength(2)
  @IsDefined()
  title: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  main_image?: MediaDto;

  @IsString()
  @IsDefined()
  type: string;
}
