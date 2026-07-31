import {
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  name!: string;

  @IsString()
  category!: string;

  @IsObject()
  doc!: Record<string, any>;

  @IsOptional()
  @IsString()
  thumbnailFileId?: string;
}
