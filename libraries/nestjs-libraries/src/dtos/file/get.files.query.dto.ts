import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetFilesQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : parseInt(value, 10)
  )
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) =>
    value === undefined || value === '' ? undefined : parseInt(value, 10)
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
