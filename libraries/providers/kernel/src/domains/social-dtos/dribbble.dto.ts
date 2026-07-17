import {
  IsDefined,
  IsOptional,
  IsString,
  IsUrl,
  MinLength, Allow } from 'class-validator';

export class DribbbleDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsString()
  @IsDefined()
  @MinLength(1, {
    message: 'Title is required',
  })
  title: string;

  @IsString()
  @IsOptional()
  @IsUrl()
  team: string;
}
