import { IsDefined, IsOptional, IsString, MinLength, Allow } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class WhopDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @MinLength(1)
  @IsDefined()
  @IsString()
  @JSONSchema({
    description: 'Company ID',
  })
  company: string;

  @MinLength(1)
  @IsDefined()
  @IsString()
  @JSONSchema({
    description: 'Experience ID for the Whop forum',
  })
  experience: string;

  @IsOptional()
  @IsString()
  title?: string;
}
