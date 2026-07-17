import { IsString, IsOptional } from 'class-validator';

export class UpdateMediaDescriptionDto {
  @IsOptional()
  @IsString()
  description?: string;
}
