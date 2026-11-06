import { IsString, MaxLength } from 'class-validator';

export class MagicGrabCleanupDto {
  @IsString()
  @MaxLength(200)
  fileId: string;
}
