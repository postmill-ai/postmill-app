import {
  IsDefined, IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateIf, Allow } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class PinterestSettingsDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsString()
  @ValidateIf((o) => !!o.title)
  @MaxLength(100)
  title: string;

  @IsString()
  @ValidateIf((o) => !!o.link)
  @IsUrl()
  link: string;

  @IsString()
  @ValidateIf((o) => !!o.dominant_color)
  dominant_color: string;

  @IsDefined({
    message: 'Board is required',
  })
  @IsString({
    message: 'Board is required',
  })
  @MinLength(1, {
    message: 'Board is required',
  })
    @JSONSchema({
    description: 'board must be an id',
  })
  board: string;
}
