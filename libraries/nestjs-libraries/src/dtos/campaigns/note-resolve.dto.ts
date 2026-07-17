import { IsBoolean } from 'class-validator';

export class NoteResolveDto {
  @IsBoolean()
  resolved!: boolean;
}
