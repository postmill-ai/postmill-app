import { IsString } from 'class-validator';

export class UpdateProviderSettingsDto {
  @IsString()
  additionalSettings: string;
}
