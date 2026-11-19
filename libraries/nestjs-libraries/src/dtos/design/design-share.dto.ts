import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateDesignShareDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  commentsEnabled?: boolean;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class CreateDesignShareCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}

export class ApproveDesignShareDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}
