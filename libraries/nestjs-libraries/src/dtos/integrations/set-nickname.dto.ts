import { IsString } from 'class-validator';

export class SetNicknameDto {
  @IsString()
  name: string;

  @IsString()
  picture: string;
}
