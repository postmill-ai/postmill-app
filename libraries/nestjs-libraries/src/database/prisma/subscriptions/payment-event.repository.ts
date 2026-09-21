import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';

/**
 * Billing-webhook persistence for every payment provider. Keeps Prisma access
 * inside a repository (layering law):
 *  - the PaymentEvent ledger (historical `StripeEvent` table) backs webhook idempotency (C1);
 *  - the Subscription.gracePeriodEnd marker backs dunning/grace (C2).
 * Rows are addressed by the vendor customer ref (`Organization.paymentId`) scoped
 * to the provider that issued it.
 */
@Injectable()
export class PaymentEventRepository {
  constructor(
    private readonly _paymentEvent: PrismaRepository<'paymentEvent'>,
    private readonly _subscription: PrismaRepository<'subscription'>
  ) {}

  async exists(id: string): Promise<boolean> {
    const found = await this._paymentEvent.model.paymentEvent.findUnique({
      where: { id },
      select: { id: true },
    });
    return !!found;
  }

  // Race-safe insert: a concurrent redelivery that loses the race is skipped, not errored.
  async record(id: string, type: string, provider: string): Promise<void> {
    await this._paymentEvent.model.paymentEvent.createMany({
      data: [{ id, type, provider }],
      skipDuplicates: true,
    });
  }

  // `until: null` clears the marker (dunning recovery) — the column is nullable.
  async setGracePeriod(customerId: string, provider: string, until: Date | null): Promise<void> {
    await this._subscription.model.subscription.updateMany({
      where: { organization: { paymentId: customerId, paymentProvider: provider } },
      data: { gracePeriodEnd: until },
    });
  }

  async getGracePeriod(customerId: string, provider: string): Promise<Date | null> {
    const sub = await this._subscription.model.subscription.findFirst({
      where: { organization: { paymentId: customerId, paymentProvider: provider } },
      select: { gracePeriodEnd: true },
    });
    return sub?.gracePeriodEnd ?? null;
  }
}
