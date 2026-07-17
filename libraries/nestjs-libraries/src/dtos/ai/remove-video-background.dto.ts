import { IsString, IsUrl } from 'class-validator';

export class RemoveVideoBackgroundDto {
  @IsString()
  @IsUrl()
  videoUrl: string;
}
