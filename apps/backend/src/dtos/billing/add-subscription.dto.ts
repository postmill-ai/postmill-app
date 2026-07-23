import { IsIn } from 'class-validator';
import { BillingTier } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/subscription.service';

export class AddSubscriptionDto {
  @IsIn(['STARTER', 'PRO', 'TEAM', 'AGENCY'])
  subscription!: BillingTier;
}
