import { IsBoolean } from 'class-validator';

export class PlugActivationDto {
  @IsBoolean()
  status: boolean;
}
