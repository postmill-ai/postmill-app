import { IsString } from 'class-validator';

export class UpdateReleaseIdDto {
  @IsString()
  releaseId: string;
}
