import { IsBoolean } from 'class-validator';

export class NotePinDto {
  @IsBoolean()
  pinned!: boolean;
}
