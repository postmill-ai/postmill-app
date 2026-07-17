import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
  ValidateNested, Allow } from 'class-validator';
import { MediaDto } from './media.dto';
import { Type } from 'class-transformer';
import { DevToTagsSettingsDto } from './dev.to.tags.settings.dto';

export class DevToSettingsDto {
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

  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.canonical && o.canonical.indexOf('(post:') === -1)
  @Matches(
    /^(|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})$/,
    {
      message: 'Invalid URL',
    }
  )
  canonical?: string;

  @IsString()
  @IsOptional()
  organization?: string;

  @IsArray()
  @ArrayMaxSize(4)
  @Type(() => DevToTagsSettingsDto)
  @ValidateNested({ each: true })
  tags: DevToTagsSettingsDto[] = [];
}
