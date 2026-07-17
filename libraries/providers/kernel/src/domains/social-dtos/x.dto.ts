import {
  IsBoolean,
  IsIn,
  IsOptional,
  Matches,
  Allow,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PollDto } from './poll.dto';

export class XDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsOptional()
  @Matches(/^(https:\/\/x\.com\/i\/communities\/\d+)?$/, {
    message:
      'Invalid X community URL. It should be in the format: https://x.com/i/communities/1493446837214187523',
  })
  community?: string;

  @IsIn(['everyone', 'following', 'mentionedUsers', 'subscribers', 'verified'])
  who_can_reply_post:
    | 'everyone'
    | 'following'
    | 'mentionedUsers'
    | 'subscribers'
    | 'verified';

  @IsOptional()
  @IsBoolean()
  made_with_ai?: boolean;

  @IsOptional()
  @IsBoolean()
  paid_partnership?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => PollDto)
  poll?: PollDto;
}
