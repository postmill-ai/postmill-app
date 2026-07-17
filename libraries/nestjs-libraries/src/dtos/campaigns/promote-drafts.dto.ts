import { IsArray, IsString } from 'class-validator';

export class PromoteDraftsDto {
  @IsArray()
  @IsString({ each: true })
  postIds!: string[];
}
