import { ArrayMaxSize, ArrayMinSize, IsArray, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class BulkCreateDesignDto {
  @IsObject()
  doc: Record<string, unknown>;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsObject({ each: true })
  rows: Record<string, string>[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameBase?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  folderId?: string;
}
