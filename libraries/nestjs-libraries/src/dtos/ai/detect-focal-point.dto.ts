import { IsString, IsUrl } from 'class-validator';

export class DetectFocalPointDto {
  @IsString()
  @IsUrl()
  imageUrl: string;
}
