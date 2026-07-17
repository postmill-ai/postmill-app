import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsHexColor,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SceneBackgroundDto {
  @IsIn(['color', 'image', 'video'])
  type!: 'color' | 'image' | 'video';

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsString()
  fileId?: string;
}

export class HeyGenSceneDto {
  @IsOptional()
  @IsString()
  avatarId?: string;

  @IsOptional()
  @IsString()
  talkingPhotoId?: string;

  @IsOptional()
  @IsString()
  avatarStyle?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(2)
  scale?: number;

  @IsString()
  voiceId!: string;

  @IsString()
  @MaxLength(4000)
  inputText!: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2)
  speed?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => SceneBackgroundDto)
  background?: SceneBackgroundDto;
}

export class DimensionDto {
  @IsInt()
  @Min(64)
  @Max(4096)
  width!: number;

  @IsInt()
  @Min(64)
  @Max(4096)
  height!: number;
}

export class CreateAvatarVideoDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HeyGenSceneDto)
  scenes!: HeyGenSceneDto[];

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
