import { IsString } from 'class-validator';

export class UpdateIntegrationGroupDto {
  @IsString()
  group: string;
}
