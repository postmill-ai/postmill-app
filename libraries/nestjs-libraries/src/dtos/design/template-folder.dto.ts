import {
  IsString,
  IsOptional,
  MaxLength,
} from 'class-validator';

export class CreateTemplateFolderDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  parentId?: string;
}

export class UpdateTemplateFolderDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class MoveTemplateDto {
  @IsOptional()
  @IsString()
  folderId?: string;
}
