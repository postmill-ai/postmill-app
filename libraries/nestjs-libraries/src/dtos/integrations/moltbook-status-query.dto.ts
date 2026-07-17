import { IsString } from 'class-validator';

export class MoltbookStatusQueryDto {
  @IsString()
  apiKey: string;
}
