import {
  IsArray,
  IsOptional,
  IsString,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BulkSaveMediaItemDto {
  @IsString()
  name: string;

  @IsString()
  path: string;

  @IsOptional()
  @IsString()
  originalName?: string;

  @IsOptional()
  @IsString()
  folderId?: string;
}

export class BulkSaveMediaDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BulkSaveMediaItemDto)
  items: BulkSaveMediaItemDto[];
}
