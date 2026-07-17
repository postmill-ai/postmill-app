import { Type } from 'class-transformer';
import { IsString, ValidateNested, Allow } from 'class-validator';

export class FarcasterId {
  @IsString()
  id: string;
}
export class FarcasterValue {
  @ValidateNested()
  @Type(() => FarcasterId)
  value: FarcasterId;
}
export class FarcasterDto {
  // Discriminator property kept by keepDiscriminatorProperty:true on the post settings
  // union; the service reads settings.__type. Allow it so forbidNonWhitelisted does not 400.
  @Allow()
  __type?: string;

  @ValidateNested({ each: true })
  @Type(() => FarcasterValue)
  subreddit: FarcasterValue[];
}
