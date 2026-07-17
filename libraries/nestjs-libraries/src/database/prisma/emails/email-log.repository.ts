import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class EmailLogRepository {
  constructor(private _db: PrismaRepository<'emailLog'>) {}

  create(data: {
    provider: string;
    toAddress: string;
    fromAddress: string;
    subject: string;
    replyTo?: string;
    providerMessageId?: string;
    status?: string;
    deliveredAt?: Date;
    organizationId?: string;
  }) {
    return this._db.model.emailLog.create({ data });
  }

  findByMessageId(provider: string, providerMessageId: string) {
    return this._db.model.emailLog.findFirst({
      where: { provider, providerMessageId },
    });
  }

  updateById(
    id: string,
    organizationId: string | null,
    data: {
      status?: string;
      providerMessageId?: string;
      error?: string;
      deliveredAt?: Date;
    },
  ) {
    return this._db.model.emailLog.update({
      where: { id, organizationId },
      data,
    });
  }

  applyStatus(id: string, organizationId: string | null, status: string, deliveredAt?: Date) {
    return this._db.model.emailLog.update({
      where: { id, organizationId },
      data: { status, ...(deliveredAt ? { deliveredAt } : {}) },
    });
  }

  deleteOlderThan(date: Date) {
    return this._db.model.emailLog.deleteMany({
      where: { sentAt: { lt: date } },
    });
  }
}
