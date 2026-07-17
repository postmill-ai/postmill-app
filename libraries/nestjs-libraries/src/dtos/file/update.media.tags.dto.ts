import { IsArray, IsString } from 'class-validator';

export class UpdateMediaTagsDto {
  @IsArray()
  @IsString({ each: true })
  tags: string[];
}
