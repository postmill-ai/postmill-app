import { IsString } from 'class-validator';

export class GenerateMusicDto {
  @IsString()
  prompt: string;
}
