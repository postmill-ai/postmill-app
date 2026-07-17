import { IsHexColor, ValidateIf } from 'class-validator';

export class SetPostColorDto {
  // null/empty clears the colour (reverts to the default primary blue).
  @ValidateIf((o) => o.color !== null && o.color !== '')
  @IsHexColor()
  color!: string | null;
}
