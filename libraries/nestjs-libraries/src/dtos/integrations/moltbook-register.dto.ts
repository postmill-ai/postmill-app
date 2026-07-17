import { IsString, MaxLength } from 'class-validator';

export class MoltbookRegisterDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsString()
  @MaxLength(2000)
  description: string;
}
