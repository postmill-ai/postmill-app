import { IsObject, IsString } from 'class-validator';

export class EstimateDto {
  @IsString()
  modelId!: string;

  @IsObject()
  input!: Record<string, unknown>;
}
