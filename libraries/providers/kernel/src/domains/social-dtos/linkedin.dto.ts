import {
  IsBoolean,
  IsOptional,
  IsString,
  Allow,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PollDto } from './poll.dto';

export class LinkedinDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsBoolean()
  @IsOptional()
  post_as_images_carousel: boolean;

  @IsString()
  @IsOptional()
  carousel_name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PollDto)
  poll?: PollDto;
}