import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DimensionDto } from './create-avatar-video.dto';

export class TalkingPhotoVideoDto {
  @IsString()
  fileId!: string;

  @IsString()
  voiceId!: string;

  @IsString()
  @MaxLength(4000)
  inputText!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DimensionDto)
  dimension?: DimensionDto;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  folderId?: string | null;
}

export class TextToSpeechDto {
  @IsString()
  voiceId!: string;

  @IsString()
  @MaxLength(4000)
  text!: string;

  @IsOptional()
  @IsString()
  folderId?: string | null;
}

export class TranslateVideoDto {
  @IsOptional()
  @IsString()
  fileId?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  languages!: string[];

  @IsOptional()
  @IsString()
  folderId?: string | null;
}
