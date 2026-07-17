import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/**
 * Billing-webhook persistence. Keeps Prisma access inside a repository (layering law):
 *  - the StripeEvent ledger backs webhook idempotency (C1);
 *  - the Subscription.gracePeriodEnd marker backs dunning/grace (C2).
 */
@Injectable()
export class StripeEventRepository {
  constructor(
    private readonly _stripeEvent: PrismaRepository<'stripeEvent'>,
    private readonly _subscription: PrismaRepository<'subscription'>
  ) {}

  async exists(id: string): Promise<boolean> {
    const found = await this._stripeEvent.model.stripeEvent.findUnique({
      where: { id },
      select: { id: true },
    });
    return !!found;
  }

  // Race-safe insert: a concurrent redelivery that loses the race is skipped, not errored.
  async record(id: string, type: string): Promise<void> {
    await this._stripeEvent.model.stripeEvent.createMany({
      data: [{ id, type }],
      skipDuplicates: true,
    });
  }

  // `until: null` clears the marker (dunning recovery) — the column is nullable.
  async setGracePeriod(customerId: string, until: Date | null): Promise<void> {
    await this._subscription.model.subscription.updateMany({
      where: { organization: { paymentId: customerId } },
      data: { gracePeriodEnd: until },
    });
  }

  async getGracePeriod(customerId: string): Promise<Date | null> {
    const sub = await this._subscription.model.subscription.findFirst({
      where: { organization: { paymentId: customerId } },
      select: { gracePeriodEnd: true },
    });
    return sub?.gracePeriodEnd ?? null;
  }
}
