import { IsString, IsOptional } from 'class-validator';

export class MoveMediaDto {
  @IsOptional()
  @IsString()
  folderId?: string;
}
