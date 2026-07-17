import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class RefundChargesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  chargeIds!: string[];
}
