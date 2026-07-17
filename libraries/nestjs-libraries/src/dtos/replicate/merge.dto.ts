import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'HasUrlOrFileId', async: false })
class HasUrlOrFileId implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as ClipDto;
    return typeof obj.url === 'string' || typeof obj.fileId === 'string';
  }

  defaultMessage(): string {
    return 'Each clip must provide either url or fileId';
  }
}

export class ClipDto {
  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  fileId?: string;

  @IsOptional()
  @IsNumber()
  trimStart?: number;

  @IsOptional()
  @IsNumber()
  trimEnd?: number;

  @Validate(HasUrlOrFileId)
  hasUrlOrFileId?: unknown;
}

export class TransitionDto {
  @IsIn(['fade', 'xfade-wipe', 'dissolve', 'fadegrayscale', 'pixelize', 'radial'])
  type!: string;

  @IsOptional()
  @IsNumber()
  duration?: number;
}

export class MergeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClipDto)
  clips!: ClipDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransitionDto)
  transitions!: TransitionDto[];

  @IsOptional()
  @IsString()
  folderId?: string | null;
}
