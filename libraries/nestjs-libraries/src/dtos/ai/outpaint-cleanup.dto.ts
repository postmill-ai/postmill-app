import { IsString, MaxLength } from 'class-validator';

export class OutpaintCleanupDto {
  @IsString()
  @MaxLength(200)
  fileId: string;
}
