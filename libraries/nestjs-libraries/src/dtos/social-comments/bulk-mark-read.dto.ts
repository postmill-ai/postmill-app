import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class BulkMarkReadDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1000)
  commentIds: string[];
}
