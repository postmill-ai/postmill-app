import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
} from 'class-validator';

export class BulkGenerateDesignDto {
  @IsObject()
  doc!: Record<string, any>;

  @IsArray()
  @ArrayMinSize(1)
  @IsObject({ each: true })
  rows!: Record<string, string>[];

  @IsOptional()
  @IsIn(['png'])
  format?: 'png';
}
