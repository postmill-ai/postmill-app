import {
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export type NotificationChannel = 'email' | 'push' | 'inApp';
export type NotificationCategory =
  | 'post_published'
  | 'post_failed'
  | 'channels'
  | 'comments'
  | 'budget'
  | 'media'
  | 'announcements'
  | 'streak'
  | 'agent'
  | 'analytics';

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'post_published',
  'post_failed',
  'channels',
  'comments',
  'budget',
  'media',
  'announcements',
  'streak',
  'agent',
  'analytics',
];

export type DigestFrequency = 'instant' | 'daily' | 'weekly' | 'never';

export interface ChannelToggles {
  email: boolean;
  push: boolean;
  inApp: boolean;
}

export class ChannelTogglesDto implements ChannelToggles {
  @IsBoolean()
  email!: boolean;

  @IsBoolean()
  push!: boolean;

  @IsBoolean()
  inApp!: boolean;
}

// Every category is optional: a partial update (only the toggled category) and
// a stale/forward frontend (sending a different category set) both validate.
// Unknown keys are stripped by the route's whitelist pipe; the service only
// merges the keys it recognizes.
export class NotificationPreferenceCategoriesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  post_published?: ChannelTogglesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  post_failed?: ChannelTogglesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  channels?: ChannelTogglesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  comments?: ChannelTogglesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  budget?: ChannelTogglesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  media?: ChannelTogglesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  announcements?: ChannelTogglesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  streak?: ChannelTogglesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  agent?: ChannelTogglesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  analytics?: ChannelTogglesDto;
}

export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  masters?: ChannelTogglesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPreferenceCategoriesDto)
  categories?: NotificationPreferenceCategoriesDto;

  @IsOptional()
  @IsEnum(['instant', 'daily', 'weekly', 'never'])
  digestFrequency?: DigestFrequency;
}

export class RegisterPushTokenDto {
  @IsString()
  token!: string;

  @IsString()
  platform!: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}

export class BroadcastNotificationDto {
  @IsString()
  title!: string;

  @IsString()
  message!: string;

  @IsOptional()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(1000)
  targetUserIds?: string[];

  @IsOptional()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @ArrayMaxSize(1000)
  targetRoles?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelTogglesDto)
  channels?: ChannelTogglesDto;
}
