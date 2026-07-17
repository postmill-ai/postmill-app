import { MediaDto } from '@gitroom/nestjs-libraries/dtos/file/media.dto';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class UserDetailDto {
  @IsString()
  @MinLength(3)
  fullname: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  lastName: string;

  @IsString()
  @IsOptional()
  bio: string;

  @IsOptional()
  @ValidateNested()
  picture: MediaDto;

  @IsOptional()
  @IsString()
  timezone: string;
}
