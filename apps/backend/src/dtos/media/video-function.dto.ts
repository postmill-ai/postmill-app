import { IsOptional, IsString } from 'class-validator';

export class VideoFunctionDto {
  @IsOptional()
  @IsString()
  identifier?: string;

  @IsOptional()
  @IsString()
  functionName?: string;

  @IsOptional()
  params?: Record<string, unknown>;
}
