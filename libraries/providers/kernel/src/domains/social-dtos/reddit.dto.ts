import {
  ArrayMinSize,
  IsBoolean,
  IsDefined,
  IsString,
  IsUrl,
  Matches,
  MinLength,
  ValidateIf,
  ValidateNested, Allow } from 'class-validator';
import { Type } from 'class-transformer';
import { JSONSchema } from 'class-validator-jsonschema';

export class RedditFlairDto {
  @IsString()
  @IsDefined()
  id: string;

  @IsString()
  @IsDefined()
  name: string;
}

export class RedditSettingsDtoInner {
  @IsString()
  @MinLength(2)
  @IsDefined()
  @JSONSchema({
    description: 'Subreddit must start with /r',
  })
  subreddit: string;

  @IsString()
  @MinLength(2)
  @IsDefined()
  title: string;

  @IsString()
  @MinLength(2)
  @IsDefined()
  @JSONSchema({
    description: 'Must be any of link, self (normal post), image, video, videogif',
  })
  type: string;

  @IsUrl()
  @IsDefined()
  @ValidateIf((o) => o.type === 'link' && o?.url?.indexOf('(post:') === -1)
  @Matches(
    /^(|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})$/,
    {
      message: 'Invalid URL',
    }
  )
  url: string;

  @IsBoolean()
  @IsDefined()
  is_flair_required: boolean;

  @ValidateIf((e) => e.is_flair_required)
  @IsDefined()
  @ValidateNested()
  @Type(() => RedditFlairDto)
  flair: RedditFlairDto;
}

export class RedditSettingsValueDto {
  @Type(() => RedditSettingsDtoInner)
  @IsDefined()
  @ValidateNested()
  value: RedditSettingsDtoInner;
}

export class RedditSettingsDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @Type(() => RedditSettingsValueDto)
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  subreddit: RedditSettingsValueDto[];
}
