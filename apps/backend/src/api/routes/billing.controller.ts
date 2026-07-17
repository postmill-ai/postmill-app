import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { CancelSubscriptionDto } from '@gitroom/backend/dtos/billing/cancel-subscription.dto';
import { LifetimeCodeDto } from '@gitroom/backend/dtos/billing/lifetime-code.dto';
import { RefundChargesDto } from '@gitroom/backend/dtos/billing/refund-charges.dto';
import { AddSubscriptionDto } from '@gitroom/backend/dtos/billing/add-subscription.dto';
import { ChangePlanDto } from '@gitroom/nestjs-libraries/dtos/billing/change-plan.dto';
import { ManageAddonsDto } from '@gitroom/nestjs-libraries/dtos/billing/manage-addons.dto';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Request } from 'express';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';

@ApiTags('Billing')
@Controller('/billing')
@UseGuards(OrgRbacGuard)
export class BillingController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _stripeService: StripeService,
    private _notificationService: NotificationService
  ) {}

  @Get('/check/:id')
  async checkId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') body: string
  ) {
    return {
      status: await this._stripeService.checkSubscription(org.id, body),
    };
  }

  @Get('/check-discount')
  async checkDiscount(@GetOrgFromRequest() org: Organization) {
    return {
      offerCoupon: !(await this._stripeService.checkDiscount(org.paymentId))
        ? false
        : AuthService.signJWT({ discount: true }),
    };
  }

  @Post('/apply-discount')
  async applyDiscount(@GetOrgFromRequest() org: Organization) {
    await this._stripeService.applyDiscount(org.paymentId);
  }

  @Post('/finish-trial')
  async finishTrial(@GetOrgFromRequest() org: Organization) {
    try {
      await this._stripeService.finishTrial(org.paymentId);
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
    return this._stripeService.embedded(
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
    return this._stripeService.subscribe(
      uniqueId,
      org.id,
      user.id,
      body,
      org.allowTrial
    );
  }

  @Get('/portal')
  async modifyPayment(@GetOrgFromRequest() org: Organization) {
    const customer = await this._stripeService.getCustomerByOrganizationId(
      org.id
    );
    const { url } = await this._stripeService.createBillingPortalLink(customer);
    return {
      portal: url,
    };
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

    return this._stripeService.setToCancel(org.id);
  }

  @Post('/prorate')
  prorate(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BillingSubscribeDto
  ) {
    return this._stripeService.prorate(org.id, body);
  }

  @Post('/lifetime')
  @RequirePermission('billing', 'manage')
  async lifetime(
    @GetOrgFromRequest() org: Organization,
    @Body() body: LifetimeCodeDto
  ) {
    return this._stripeService.lifetimeDeal(org.id, body.code);
  }

  @Get('/charges')
  @RequirePermission('billing', 'manage')
  async getCharges(
    @GetOrgFromRequest() org: Organization
  ) {
    return this._stripeService.getCharges(org.id);
  }

  @Post('/refund-charges')
  @RequirePermission('billing', 'manage')
  async refundCharges(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RefundChargesDto
  ) {
    return this._stripeService.refundCharges(org.id, body.chargeIds);
  }

  @Post('/cancel-subscription')
  @RequirePermission('billing', 'manage')
  async cancelSubscription(
    @GetOrgFromRequest() org: Organization
  ) {
    return this._stripeService.cancelSubscription(org.id);
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
    return this._stripeService.changePlan(org.id, user.id, body.tier);
  }

  @Post('/addons')
  @RequirePermission('billing', 'manage')
  async manageAddons(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ManageAddonsDto
  ) {
    return this._stripeService.createOrUpdateAddon(
      org.id,
      body.type,
      body.packs
    );
  }

  @Delete('/addons/:type')
  @RequirePermission('billing', 'manage')
  async cancelAddon(
    @GetOrgFromRequest() org: Organization,
    @Param('type') type: 'storage' | 'video_exports'
  ) {
    if (type !== 'storage' && type !== 'video_exports') {
      throw new BadRequestException('Invalid add-on type');
    }
    return this._stripeService.cancelAddon(org.id, type);
  }

}
