import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsHexColor,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum DesignerCopyKind {
  Headline = 'headline',
  Promotion = 'promotion',
  Caption = 'caption',
  Cta = 'cta',
}

export class DesignerAssistantSelectionDto {
  @IsString()
  @MaxLength(40)
  type!: string;

  @IsNumber()
  @Min(-16384)
  @Max(16384)
  x!: number;

  @IsNumber()
  @Min(-16384)
  @Max(16384)
  y!: number;

  @IsNumber()
  @Min(0)
  @Max(16384)
  width!: number;

  @IsNumber()
  @Min(0)
  @Max(16384)
  height!: number;
}

export class DesignerAssistantContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fontFamily?: string;

  @IsOptional()
  @IsHexColor()
  fill?: string;

  @IsOptional()
  @IsNumber()
  @Min(-16384)
  @Max(16384)
  x?: number;

  @IsOptional()
  @IsNumber()
  @Min(-16384)
  @Max(16384)
  y?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(16384)
  width?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(16384)
  height?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(16384)
  canvasWidth?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(16384)
  canvasHeight?: number;

  @IsOptional()
  @IsIn(['image', 'video'])
  mode?: 'image' | 'video';

  @IsOptional()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DesignerAssistantSelectionDto)
  selection?: DesignerAssistantSelectionDto[];
}

export class GenerateDesignerCopyDto {
  @IsEnum(DesignerCopyKind)
  kind!: DesignerCopyKind;

  @IsString()
  @MaxLength(2000)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  selectedText?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DesignerAssistantContextDto)
  context?: DesignerAssistantContextDto;
}

export class DesignerSuggestionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DesignerAssistantContextDto)
  context?: DesignerAssistantContextDto;
}
