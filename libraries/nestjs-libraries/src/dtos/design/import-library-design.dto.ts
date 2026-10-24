import { IsNotEmpty, IsString } from 'class-validator';

export class ImportLibraryDesignDto {
  @IsString()
  @IsNotEmpty()
  fileId: string;
}
