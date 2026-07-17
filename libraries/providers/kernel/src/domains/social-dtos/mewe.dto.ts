import { IsIn, IsOptional, IsString, MinLength, ValidateIf, Allow } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class MeweDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @IsIn(['timeline', 'group'])
  @JSONSchema({
    description: 'Where to post: timeline or group',
  })
  postType: 'timeline' | 'group';

  @ValidateIf((o) => o.postType === 'group')
  @MinLength(1)
  @IsString()
  @JSONSchema({
    description: 'Group must be an id',
  })
  @IsOptional()
  group?: string;
}
