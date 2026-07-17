import { IsArray, IsObject } from 'class-validator';

export class ApplyOpsDto {
  @IsObject()
  doc!: Record<string, any>;

  @IsArray()
  @IsObject({ each: true })
  ops!: Record<string, any>[];
}
