import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class ChangePostDateDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsEnum(['schedule', 'update'])
  action?: 'schedule' | 'update';
}
