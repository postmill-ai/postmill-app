import { IsOptional, IsString, MinLength, Allow } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class ListmonkDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsString()
  @MinLength(1)
  subject: string;

  @IsString()
  preview: string;

  @IsString()
  @JSONSchema({
    description: 'List must be an id',
  })
  list: string;

  @IsString()
  @IsOptional()
  @JSONSchema({
    description: 'Template must be an id',
  })
  template: string;
}
