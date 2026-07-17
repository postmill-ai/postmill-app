import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
} from 'class-validator';

export class SignatureDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsDefined()
  content: string;

  @IsBoolean()
  @IsDefined()
  autoAdd: boolean;

  // Integration ids this signature applies to. Empty = all channels.
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  channels?: string[];

  // File id of an optional logo/sticker attached to the signature.
  @IsString()
  @IsOptional()
  pictureId?: string;
}
