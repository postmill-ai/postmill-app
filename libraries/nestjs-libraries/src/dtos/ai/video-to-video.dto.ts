import { IsString, IsUrl } from 'class-validator';

export class VideoToVideoDto {
  @IsString()
  @IsUrl()
  videoUrl: string;

  @IsString()
  prompt: string;
}
