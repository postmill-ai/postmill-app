import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/file/media.dto';
import {
  allProviders,
  type AllProvidersSettings,
  EmptySettings,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import { ValidContent } from '@gitroom/helpers/utils/valid.images';
import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';

export class Integration {
  @ApiProperty({ description: 'The channel (integration) id to post to.' })
  @IsDefined()
  @IsString()
  id: string;
}

export class PostContent {
  @ApiProperty({ description: 'The text content for this part of the post.' })
  @IsDefined()
  @IsString()
  @Validate(ValidContent)
  @Transform(({ value }) => sanitizePostContent(value))
  content: string;

  @ApiPropertyOptional({ description: 'Client-side id for this content block.' })
  @IsOptional()
  @IsString()
  id: string;

  @ApiPropertyOptional({
    description:
      'Delay in minutes before this block (thread spacing). 0–1440 (max 24h).',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1440)
  delay: number;

  @ApiProperty({
    type: () => [MediaDto],
    description: 'Media (images/video) attached to this content block.',
  })
  @IsArray()
  @Type(() => MediaDto)
  @ValidateNested({ each: true })
  image: MediaDto[];
}

export class Post {
  @ApiPropertyOptional({ description: 'Post type override (e.g. "draft").' })
  // Needs a class-validator decorator or the global forbidNonWhitelisted pipe rejects it
  // ("property type should not exist") — which also defeats the draft settings-skip below.
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ type: () => Integration })
  @IsDefined()
  @Type(() => Integration)
  @ValidateNested()
  integration: Integration;

  @ApiProperty({
    type: () => [PostContent],
    description: 'One or more content blocks (a thread is multiple blocks).',
  })
  @IsDefined()
  @ArrayMinSize(1)
  @IsArray()
  @Type(() => PostContent)
  @ValidateNested({ each: true })
  value: PostContent[];

  @ApiPropertyOptional({ description: 'Group id to tie sibling posts together.' })
  @IsOptional()
  @IsString()
  group: string;

  @ApiPropertyOptional({
    description: 'Per-provider settings (poll, first comment, etc.).',
  })
  @ValidateIf((o) => o.type !== 'draft')
  @ValidateNested()
  @Type(() => EmptySettings, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: '__type',
      subTypes: allProviders(EmptySettings),
    },
  })
  settings: AllProvidersSettings;
}

class Tags {
  @ApiProperty({ description: 'Tag value/slug.' })
  @IsDefined()
  @IsString()
  value: string;

  @ApiProperty({ description: 'Human-readable tag label.' })
  @IsDefined()
  @IsString()
  label: string;
}

export class CreatePostDto {
  @ApiProperty({
    enum: ['draft', 'schedule', 'now', 'update'],
    description: 'What to do with the post.',
  })
  @IsDefined()
  @IsIn(['draft', 'schedule', 'now', 'update'])
  type: 'draft' | 'schedule' | 'now' | 'update';

  @ApiPropertyOptional({ description: 'Ordering hint among sibling posts.' })
  @IsOptional()
  @IsString()
  order?: string;

  @ApiPropertyOptional({
    description: 'Origin of the post (e.g. "API", "CLI").',
  })
  @IsOptional()
  @IsString()
  creationMethod?: string;

  @ApiPropertyOptional({ description: 'Campaign id to file this post under.' })
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional({ description: 'Brand profile id to apply.' })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiProperty({ description: 'Whether to shorten links in the content.' })
  @IsDefined()
  @IsBoolean()
  shortLink: boolean;

  @ApiPropertyOptional({ description: 'Repeat interval in days, if recurring.' })
  @IsOptional()
  @IsNumber()
  inter?: number;

  @ApiProperty({
    description: 'Publish date (ISO 8601).',
    example: '2026-02-01T12:00:00.000Z',
  })
  @IsDefined()
  @IsDateString()
  date: string;

  @ApiProperty({ type: () => [Tags], description: 'Tags to attach.' })
  @IsArray()
  @IsDefined()
  @Type(() => Tags)
  @ValidateNested({ each: true })
  tags: Tags[];

  @ApiProperty({
    type: () => [Post],
    description: 'One post per target channel.',
  })
  @IsDefined()
  @Type(() => Post)
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  posts: Post[];
}
