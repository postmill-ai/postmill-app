import { IsObject } from 'class-validator';

export class ValidateDocDto {
  @IsObject()
  doc!: Record<string, any>;
}
