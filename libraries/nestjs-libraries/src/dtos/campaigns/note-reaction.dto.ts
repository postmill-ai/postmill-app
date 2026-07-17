import { IsString, MaxLength } from 'class-validator';

export class NoteReactionDto {
  @IsString()
  @MaxLength(16)
  emoji!: string;
}
