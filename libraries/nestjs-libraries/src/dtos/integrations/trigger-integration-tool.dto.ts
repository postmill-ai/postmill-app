import { IsString, IsObject, IsOptional } from 'class-validator';

export class TriggerIntegrationToolDto {
  @IsString()
  methodName: string;

  @IsOptional()
  @IsObject()
  data: Record<string, string> = {};
}
