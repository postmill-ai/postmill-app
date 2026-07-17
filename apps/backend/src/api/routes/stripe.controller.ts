import {
  Controller,
  HttpException,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { ApiTags } from '@nestjs/swagger';
import Stripe from 'stripe';

@ApiTags('Stripe')
@Controller('/stripe')
export class StripeController {
  constructor(private readonly _stripeService: StripeService) {}

  @Post('/')
  async stripe(@Req() req: RawBodyRequest<Request>) {
    const event = this._stripeService.validateRequest(
      req.rawBody,
      // @ts-ignore
      req.headers['stripe-signature'],
      process.env.STRIPE_SIGNING_KEY
    );

    // Maybe it comes from another stripe webhook
    if (
       
      // @ts-ignore
      event?.data?.object?.metadata?.service !== 'postmill' &&
      event.type !== 'invoice.payment_succeeded' &&
      event.type !== 'invoice.payment_failed'
    ) {
      return { ok: true };
    }

    // Idempotency (C1): Stripe redelivers events; ignore an event.id we've already
    // processed so a redelivered subscription mutation can't re-run the transition.
    if (await this._stripeService.isEventProcessed(event.id)) {
      return { ok: true };
    }

    try {
      let result: any;
      // @ts-ignore
      const metadata = event?.data?.object?.metadata || {};
      const isAddon =
        metadata.service === 'postmill' &&
        (metadata.addon === 'storage' || metadata.addon === 'video_exports');

      switch (event.type) {
        case 'invoice.payment_succeeded':
          result = await this._stripeService.paymentSucceeded(event);
          break;
        case 'invoice.payment_failed':
          result = await this._stripeService.paymentFailed(event);
          break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          result = isAddon
            ? await this._stripeService.syncAddonQuantities(
                event.data.object.customer as string
              )
            : await this._routeBaseSubscriptionEvent(event);
          break;
        default:
          result = { ok: true };
      }

      // Record only after successful processing so a thrown error stays retryable.
      await this._stripeService.recordEvent(event.id, event.type);
      return result;
    } catch (e) {
      throw new HttpException(e, 500);
    }
  }

  private async _routeBaseSubscriptionEvent(
    event:
      | Stripe.CustomerSubscriptionCreatedEvent
      | Stripe.CustomerSubscriptionUpdatedEvent
      | Stripe.CustomerSubscriptionDeletedEvent
  ) {
    switch (event.type) {
      case 'customer.subscription.created':
        return this._stripeService.createSubscription(event);
      case 'customer.subscription.updated':
        return this._stripeService.updateSubscription(event);
      case 'customer.subscription.deleted':
        return this._stripeService.deleteSubscription(event);
      default:
        return { ok: true };
    }
  }
}
