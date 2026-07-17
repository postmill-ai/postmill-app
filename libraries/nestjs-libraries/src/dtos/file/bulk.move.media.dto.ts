import { IsArray, IsString, IsOptional } from 'class-validator';

export class BulkMoveMediaDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @IsOptional()
  @IsString()
  folderId?: string;
}
