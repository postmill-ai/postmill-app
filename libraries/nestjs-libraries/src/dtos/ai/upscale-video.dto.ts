import { IsNumber, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class UpscaleVideoDto {
  @IsString()
  @IsUrl()
  videoUrl: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(8)
  scale?: number;
}
