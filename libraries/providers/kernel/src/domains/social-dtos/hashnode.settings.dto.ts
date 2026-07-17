import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
  ValidateNested, Allow } from 'class-validator';
import { Type } from 'class-transformer';
import { MediaDto } from './media.dto';

export class HashnodeTagsSettings {
  @IsString()
  value: string;

  @IsString()
  label: string;
}

export class HashnodeSettingsDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsString()
  @MinLength(6)
  @IsDefined()
  title: string;

  @IsString()
  @MinLength(2)
  @IsOptional()
  subtitle: string;

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
  @IsDefined()
  publication?: string;

  @IsArray()
  @ArrayMinSize(1)
  @Type(() => HashnodeTagsSettings)
  @ValidateNested({ each: true })
  tags: HashnodeTagsSettings[];
}
