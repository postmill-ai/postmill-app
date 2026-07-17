import { IsDefined, IsString, MinLength, Allow } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class SkoolDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @MinLength(1)
  @IsDefined()
  @IsString()
  @JSONSchema({
    description: 'Group must be an id',
  })
  group: string;

  @MinLength(1)
  @IsDefined()
  @IsString()
  @JSONSchema({
    description: 'Label must be an id',
  })
  label: string;

  @MinLength(1)
  @IsDefined()
  @IsString()
  @JSONSchema({
    description: 'Title of the post',
  })
  title: string;
}
