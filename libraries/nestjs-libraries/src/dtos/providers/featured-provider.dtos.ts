import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PROVIDER_DOMAINS } from '@gitroom/provider-kernel';

export class FeaturedProviderDto {
  @IsString()
  @IsIn([...PROVIDER_DOMAINS])
  domain: string;

  @IsString()
  providerId: string;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  sortOrder: number;
}

export class FeaturedProviderRemoveDto {
  @IsString()
  domain: string;

  @IsString()
  providerId: string;
}

export class FeaturedReorderEntryDto {
  @IsString()
  providerId: string;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  sortOrder: number;
}

export class FeaturedReorderDto {
  @IsString()
  domain: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FeaturedReorderEntryDto)
  entries: FeaturedReorderEntryDto[];
}
