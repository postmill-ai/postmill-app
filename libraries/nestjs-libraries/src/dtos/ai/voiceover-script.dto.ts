import { IsNotEmpty, IsString } from 'class-validator';

export class VoiceoverScriptDto {
  @IsString()
  @IsNotEmpty()
  topic: string;
}
