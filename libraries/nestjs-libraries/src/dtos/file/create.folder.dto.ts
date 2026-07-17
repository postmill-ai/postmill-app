import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
} from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @MaxLength(50, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  storageProviderId?: string;
}
