import { IsString, IsUrl } from 'class-validator';

export class RemoveBackgroundDto {
  @IsString()
  @IsUrl()
  imageUrl: string;
}
