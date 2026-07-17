import { IsOptional, IsString } from 'class-validator';

export class SetActiveShortlinkDto {
  @IsOptional()
  @IsString()
  version?: string;
}
