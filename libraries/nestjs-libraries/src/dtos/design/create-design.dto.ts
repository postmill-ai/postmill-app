import {
  IsObject,
  IsString,
  IsNumber,
  IsOptional,
} from 'class-validator';

export class CreateDesignDto {
  @IsString()
  name!: string;

  @IsObject()
  doc!: Record<string, any>;

  // Width/height are optional on the wire: the service derives them from
  // doc.outputs[0] when a doc is supplied (the normal path).
  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsString()
  previewDataUrl?: string;

  @IsOptional()
  @IsString()
  previewFileId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;
}
