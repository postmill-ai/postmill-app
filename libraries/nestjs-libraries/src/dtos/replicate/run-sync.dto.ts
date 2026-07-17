import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class RunSyncDto {
  @IsString()
  modelId!: string;

  // The composer sends one payload shape for both sync and async runs; sync
  // ignores these two, but they must be whitelisted or the global validation
  // pipe (forbidNonWhitelisted) rejects the request with a 400.
  @IsOptional()
  @IsString()
  versionId?: string;

  @IsOptional()
  @IsString()
  folderId?: string | null;

  @IsObject()
  input!: Record<string, unknown>;

  @IsIn(['image', 'stt'])
  operation!: 'image' | 'stt';
}
