import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

export interface EmailLogCreateData {
  provider: string;
  toAddress: string;
  fromAddress: string;
  subject: string;
  replyTo?: string;
  providerMessageId?: string;
  status?: string;
  deliveredAt?: Date;
  organizationId?: string;
  campaignId?: string;
}

@Injectable()
export class EmailLogRepository {
  constructor(private _db: PrismaRepository<'emailLog'>) {}

  create(data: EmailLogCreateData) {
    return this._db.model.emailLog.create({ data });
  }

  async claimCampaignLog(data: EmailLogCreateData & { campaignId: string }) {
    try {
      return { log: await this.create(data), claimed: true as const };
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      const log = await this._db.model.emailLog.findUnique({
        where: {
          campaignId_toAddress: {
            campaignId: data.campaignId,
            toAddress: data.toAddress,
          },
        },
      });
      if (!log) throw error;
      return { log, claimed: false as const };
    }
  }

  findByMessageId(provider: string, providerMessageId: string) {
    return this._db.model.emailLog.findFirst({
      where: { provider, providerMessageId },
    });
  }

  async getTerminalNegativeAddresses() {
    const rows = await this._db.model.emailLog.findMany({
      where: { status: { in: ['bounced', 'complained'] } },
      select: { toAddress: true },
      distinct: ['toAddress'],
    });
    return rows.map((row) => row.toAddress);
  }

  getCampaignStatus(campaignId: string) {
    return this._db.model.emailLog.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { _all: true },
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
