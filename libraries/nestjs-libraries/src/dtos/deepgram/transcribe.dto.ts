import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TranscribeDto {
  // A /files asset (audio or video) to transcribe.
  @IsString()
  fileId!: string;

  // Deepgram model id (e.g. nova-3, nova-2, whisper). Defaults server-side.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  model?: string;

  // BCP-47 language hint (e.g. en, es). Omit to let Deepgram auto-detect.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;
}
