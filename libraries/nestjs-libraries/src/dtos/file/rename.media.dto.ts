import { IsString, MaxLength } from 'class-validator';

export class RenameMediaDto {
  @IsString()
  @MaxLength(100)
  name: string;
}
