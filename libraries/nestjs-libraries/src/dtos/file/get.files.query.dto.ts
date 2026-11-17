import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetFilesQueryDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value)
  )
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : Number(value)
  )
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsIn(['name', 'size', 'type', 'createdAt'])
  sort?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: string;

  @IsOptional()
  @IsString()
  highlight?: string;
}

export class GetFilesByIdsQueryDto {
  @IsOptional()
  @IsString()
  ids?: string;
}
