import { IsString, IsNotEmpty } from 'class-validator';

export class ShortlinkActiveDto {
  @IsString()
  @IsNotEmpty()
  identifier!: string;
}
