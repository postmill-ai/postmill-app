import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';

const commentList = {
  orderBy: { createdAt: 'desc' as const },
  take: 100,
  select: {
    id: true,
    authorName: true,
    content: true,
    createdAt: true,
  },
};

@Injectable()
export class DesignShareRepository {
  constructor(
    private readonly _design: PrismaRepository<'design'>,
    private readonly _share: PrismaRepository<'designShare'>,
    private readonly _comment: PrismaRepository<'designShareComment'>,
  ) {}

  findDesign(orgId: string, designId: string) {
    return this._design.model.design.findFirst({
      where: { id: designId, organizationId: orgId, deletedAt: null },
      select: { id: true, organizationId: true, name: true, doc: true },
    });
  }

  findShareByDesign(orgId: string, designId: string) {
    return this._share.model.designShare.findFirst({
      where: { designId, organizationId: orgId },
      include: { comments: commentList },
    });
  }

  findShareById(orgId: string, shareId: string) {
    return this._share.model.designShare.findFirst({
      where: { id: shareId, organizationId: orgId },
      include: { comments: commentList },
    });
  }

  findActiveByToken(token: string, now: Date) {
    return this._share.model.designShare.findFirst({
      where: {
        token,
        enabled: true,
        expiresAt: { gt: now },
        design: { deletedAt: null },
      },
      include: {
        design: { select: { id: true, organizationId: true, name: true, doc: true } },
        comments: commentList,
      },
    });
  }

  saveShare(
    orgId: string,
    designId: string,
    data: {
      token: string;
      enabled: boolean;
      commentsEnabled: boolean;
      expiresAt: Date;
      resetApproval?: boolean;
    },
  ) {
    const { resetApproval = false, ...shareData } = data;
    return this._share.model.designShare.upsert({
      where: { designId },
      create: { organizationId: orgId, designId, ...shareData },
      update: {
        token: data.token,
        enabled: data.enabled,
        commentsEnabled: data.commentsEnabled,
        expiresAt: data.expiresAt,
        ...(resetApproval ? { approvedAt: null, approvedBy: null } : {}),
      },
      include: { comments: commentList },
    });
  }

  async disableShare(orgId: string, designId: string) {
    await this._share.model.designShare.updateMany({
      where: { designId, organizationId: orgId },
      data: { enabled: false },
    });
    return this.findShareByDesign(orgId, designId);
  }

  createComment(data: {
    shareId: string;
    organizationId: string;
    authorName: string;
    content: string;
  }) {
    return this._comment.model.designShareComment.create({
      data,
      select: { id: true, authorName: true, content: true, createdAt: true },
    });
  }

  async approveFirst(orgId: string, shareId: string, approvedBy: string, approvedAt: Date) {
    await this._share.model.designShare.updateMany({
      where: { id: shareId, organizationId: orgId, approvedAt: null },
      data: { approvedBy, approvedAt },
    });
    return this.findShareById(orgId, shareId);
  }
}
