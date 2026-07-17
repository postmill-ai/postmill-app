import { IsNumber, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class UpscaleImageDto {
  @IsString()
  @IsUrl()
  imageUrl: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(8)
  scale?: number;
}
