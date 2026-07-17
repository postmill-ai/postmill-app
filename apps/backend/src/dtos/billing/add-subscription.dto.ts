import { IsIn } from 'class-validator';
import { BillingTier } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';

export class AddSubscriptionDto {
  @IsIn(['STARTER', 'PRO', 'TEAM', 'AGENCY'])
  subscription!: BillingTier;
}
