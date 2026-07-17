import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class RunAsyncDto {
  @IsString()
  modelId!: string;

  @IsOptional()
  @IsString()
  versionId?: string;

  @IsObject()
  input!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  folderId?: string | null;

  @IsIn(['image', 'video', 'audio'])
  operation!: 'image' | 'video' | 'audio';
}
