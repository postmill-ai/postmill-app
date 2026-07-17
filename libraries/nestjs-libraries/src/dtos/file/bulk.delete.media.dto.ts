import { IsArray, IsString } from 'class-validator';

export class BulkDeleteMediaDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}
