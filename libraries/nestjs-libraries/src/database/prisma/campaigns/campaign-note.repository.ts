import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class CampaignNoteRepository {
  constructor(private _prisma: PrismaService) {}

  // Top-level notes for a campaign with their (non-deleted) replies and reactions.
  listForCampaign(campaignId: string, organizationId: string) {
    return this._prisma.campaignNote.findMany({
      where: { campaignId, organizationId, parentId: null, deletedAt: null },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'asc' }],
      include: {
        reactions: true,
        replies: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: { reactions: true },
        },
      },
    });
  }

  findById(id: string, organizationId: string) {
    return this._prisma.campaignNote.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
  }

  create(data: {
    campaignId: string;
    organizationId: string;
    createdById: string;
    content: string;
    parentId?: string | null;
    mentions?: string[];
  }) {
    return this._prisma.campaignNote.create({
      data: {
        campaignId: data.campaignId,
        organizationId: data.organizationId,
        createdById: data.createdById,
        content: data.content,
        parentId: data.parentId ?? null,
        mentions: data.mentions ?? [],
      },
    });
  }

  updateContent(id: string, organizationId: string, content: string) {
    return this._prisma.campaignNote.updateMany({
      where: { id, organizationId, deletedAt: null },
      data: { content, editedAt: new Date() },
    });
  }

  softDelete(id: string, organizationId: string) {
    return this._prisma.campaignNote.updateMany({
      where: { id, organizationId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  setPinned(id: string, organizationId: string, pinned: boolean) {
    return this._prisma.campaignNote.updateMany({
      where: { id, organizationId, deletedAt: null },
      data: { pinned },
    });
  }

  setResolved(
    id: string,
    organizationId: string,
    resolved: boolean,
    userId: string
  ) {
    return this._prisma.campaignNote.updateMany({
      where: { id, organizationId, deletedAt: null },
      data: {
        resolvedAt: resolved ? new Date() : null,
        resolvedById: resolved ? userId : null,
      },
    });
  }

  // Toggle a reaction: remove if it already exists, else create.
  // D7: defense-in-depth org check — the note must belong to the caller's org.
  // M-04: the read/delete/create runs inside a Prisma transaction so concurrent
  // toggles cannot both see "no existing reaction" and create duplicate rows.
  async toggleReaction(
    noteId: string,
    userId: string,
    emoji: string,
    organizationId: string
  ) {
    return this._prisma.$transaction(async (tx) => {
      const note = await tx.campaignNote.findFirst({
        where: { id: noteId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!note) {
        throw new Error('Note not found');
      }

      const existing = await tx.campaignNoteReaction.findUnique({
        where: { noteId_userId_emoji: { noteId, userId, emoji } },
      });
      if (existing) {
        await tx.campaignNoteReaction.delete({
          where: { id: existing.id },
        });
        return { reacted: false };
      }
      await tx.campaignNoteReaction.create({
        data: { noteId, userId, emoji },
      });
      return { reacted: true };
    });
  }
}
