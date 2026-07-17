import { IsOptional, IsString } from 'class-validator';

export class SaveProviderPageDto {
  @IsOptional()
  @IsString()
  state?: string;
}
