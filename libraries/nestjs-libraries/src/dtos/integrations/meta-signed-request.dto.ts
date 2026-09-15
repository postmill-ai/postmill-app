import { IsString, MaxLength } from 'class-validator';

/** Body Meta POSTs (form-encoded) to the deauthorize / data-deletion callbacks. */
export class MetaSignedRequestDto {
  @IsString()
  @MaxLength(8192)
  signed_request: string;
}
