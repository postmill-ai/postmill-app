import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SubscriptionService } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { PaymentsService } from '@postmill-ai/nestjs-libraries/payments/payments.service';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { BillingSubscribeDto } from '@postmill-ai/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { CancelSubscriptionDto } from '@postmill-ai/backend/dtos/billing/cancel-subscription.dto';
import { LifetimeCodeDto } from '@postmill-ai/backend/dtos/billing/lifetime-code.dto';
import { RefundChargesDto } from '@postmill-ai/backend/dtos/billing/refund-charges.dto';
import { AddSubscriptionDto } from '@postmill-ai/backend/dtos/billing/add-subscription.dto';
import { NativeVerifyDto } from '@postmill-ai/nestjs-libraries/dtos/billing/native-verify.dto';
import { ChangePlanDto } from '@postmill-ai/nestjs-libraries/dtos/billing/change-plan.dto';
import { ManageAddonsDto } from '@postmill-ai/nestjs-libraries/dtos/billing/manage-addons.dto';
import {
  ADDONS,
  AddonType,
} from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { NotificationService } from '@postmill-ai/nestjs-libraries/database/prisma/notifications/notification.service';
import { Request } from 'express';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import { OrgRbacGuard } from '@postmill-ai/backend/services/auth/rbac/org-rbac.guard';

@ApiTags('Billing')
@Controller('/billing')
@UseGuards(OrgRbacGuard)
export class BillingController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _payments: PaymentsService,
    private _notificationService: NotificationService
  ) {}

  /** Deployment + org payment configuration the billing UI branches on (no secrets). */
  @Get('/config')
  getConfig(@GetOrgFromRequest() org: Organization) {
    return this._payments.getConfig(org);
  }

  @Get('/check/:id')
  async checkId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') body: string,
    // Providers whose webhooks lag the checkout redirect append their own
    // subscription ref to the return URL; the poll reconciles from it.
    @Query('ref') ref?: string
  ) {
    return {
      status: await this._payments.checkSubscription(org, body, ref || undefined),
    };
  }

  @Get('/check-discount')
  async checkDiscount(@GetOrgFromRequest() org: Organization) {
    return {
      offerCoupon: !(await this._payments.checkDiscount(org))
        ? false
        : AuthService.signJWT({ discount: true }),
    };
  }

  @Post('/apply-discount')
  async applyDiscount(@GetOrgFromRequest() org: Organization) {
    await this._payments.applyDiscount(org);
  }

  @Post('/finish-trial')
  async finishTrial(@GetOrgFromRequest() org: Organization) {
    try {
      await this._payments.finishTrial(org);
    } catch (err) {}
    return {
      finish: true,
    };
  }

  @Get('/is-trial-finished')
  async isTrialFinished(@GetOrgFromRequest() org: Organization) {
    return {
      finished: !org.isTrailing,
    };
  }

  @Post('/embedded')
  embedded(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    @Req() req: Request
  ) {
    const uniqueId = req?.cookies?.track;
    return this._payments.startCheckout(
      'embedded',
      uniqueId,
      org.id,
      user.id,
      body,
      org.allowTrial
    );
  }

  @Post('/subscribe')
  subscribe(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    @Req() req: Request
  ) {
    const uniqueId = req?.cookies?.track;
    return this._payments.startCheckout(
      'hosted',
      uniqueId,
      org.id,
      user.id,
      body,
      org.allowTrial
    );
  }

  @Get('/portal')
  async modifyPayment(@GetOrgFromRequest() org: Organization) {
    return this._payments.portalUrl(org.id);
  }

  @Get('/')
  getCurrentBilling(@GetOrgFromRequest() org: Organization) {
    return this._subscriptionService.getSubscriptionByOrganizationId(org.id);
  }

  @Post('/cancel')
  @RequirePermission('billing', 'manage')
  async cancel(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CancelSubscriptionDto
  ) {
    await this._notificationService.sendEmail(
      process.env.EMAIL_FROM_ADDRESS,
      'Subscription Cancelled',
      `Organization ${org.name} has cancelled their subscription because: ${body.feedback}`,
      user.email
    );

    return this._payments.setToCancel(org.id);
  }

  @Post('/prorate')
  prorate(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BillingSubscribeDto
  ) {
    return this._payments.prorate(org.id, body);
  }

  @Post('/lifetime')
  @RequirePermission('billing', 'manage')
  async lifetime(
    @GetOrgFromRequest() org: Organization,
    @Body() body: LifetimeCodeDto
  ) {
    return this._payments.lifetimeDeal(org.id, body.code);
  }

  @Get('/charges')
  @RequirePermission('billing', 'manage')
  async getCharges(
    @GetOrgFromRequest() org: Organization
  ) {
    return this._payments.getCharges(org.id);
  }

  @Post('/refund-charges')
  @RequirePermission('billing', 'manage')
  async refundCharges(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RefundChargesDto
  ) {
    return this._payments.refundCharges(org.id, body.chargeIds);
  }

  @Post('/cancel-subscription')
  @RequirePermission('billing', 'manage')
  async cancelSubscription(
    @GetOrgFromRequest() org: Organization
  ) {
    return this._payments.cancelSubscription(org.id);
  }

  @Post('/add-subscription')
  @RequirePermission('billing', 'manage')
  async addSubscription(
    @Body() body: AddSubscriptionDto,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    await this._subscriptionService.addSubscription(
      org.id,
      user.id,
      body.subscription
    );
  }

  @Post('/change-plan')
  @RequirePermission('billing', 'manage')
  async changePlan(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: ChangePlanDto
  ) {
    return this._payments.changePlan(org.id, user.id, body.tier);
  }

  @Post('/addons')
  @RequirePermission('billing', 'manage')
  async manageAddons(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ManageAddonsDto
  ) {
    return this._payments.createOrUpdateAddon(
      org.id,
      body.type,
      body.packs
    );
  }

  @Delete('/addons/:type')
  @RequirePermission('billing', 'manage')
  async cancelAddon(
    @GetOrgFromRequest() org: Organization,
    @Param('type') type: AddonType
  ) {
    if (!Object.prototype.hasOwnProperty.call(ADDONS, type)) {
      throw new BadRequestException('Invalid add-on type');
    }
    return this._payments.cancelAddon(org.id, type);
  }

  /** Mobile app hands over a store purchase; the server verifies it with the store. */
  @Post('/native/verify')
  @RequirePermission('billing', 'manage')
  async verifyNativePurchase(
    @GetOrgFromRequest() org: Organization,
    @Body() body: NativeVerifyDto
  ) {
    return this._payments.verifyNativePurchase(org, body.provider, body.payload);
  }
}
