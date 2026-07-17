import { IsOptional, IsString } from 'class-validator';

export class CancelSubscriptionDto {
  @IsOptional()
  @IsString()
  feedback?: string;
}
