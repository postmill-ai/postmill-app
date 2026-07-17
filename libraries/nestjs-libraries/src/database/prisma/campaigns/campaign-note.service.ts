import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CampaignNoteRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-note.repository';
import { CampaignsService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { sanitizeNoteHtml } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-note.sanitize';

type ReactionRow = { emoji: string; userId: string };
type NoteRow = {
  id: string;
  content: string;
  createdById: string;
  parentId: string | null;
  pinned: boolean;
  resolvedAt: Date | null;
  resolvedById: string | null;
  editedAt: Date | null;
  createdAt: Date;
  reactions: ReactionRow[];
  replies?: NoteRow[];
};

@Injectable()
export class CampaignNoteService {
  private readonly _logger = new Logger(CampaignNoteService.name);

  constructor(
    private _notes: CampaignNoteRepository,
    private _campaigns: CampaignsService,
    private _users: UsersService,
    private _org: OrganizationService,
    private _notifications: NotificationService
  ) {}

  // Mentioned userIds embedded as `data-mention-id="…"` spans in the note HTML.
  private _extractMentionIds(html: string): string[] {
    const ids = new Set<string>();
    const re = /data-mention-id="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (m[1]) ids.add(m[1]);
    }
    return [...ids];
  }

  // A note is empty if, after stripping tags, there is no text AND no embedded media.
  private _isEmpty(html: string): boolean {
    const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    return !text && !/<(img|video)\b/i.test(html);
  }

  private async _requireCampaign(campaignId: string, organizationId: string) {
    const campaign = await this._campaigns.get(campaignId, organizationId);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }

  private async _orgMemberIds(organizationId: string): Promise<Set<string>> {
    const team = await this._org.getTeam(organizationId);
    return new Set((team?.users ?? []).map((u) => u.user.id));
  }

  async list(campaignId: string, organizationId: string, userId: string) {
    await this._requireCampaign(campaignId, organizationId);
    const notes = (await this._notes.listForCampaign(
      campaignId,
      organizationId
    )) as unknown as NoteRow[];

    // Resolve every author (top-level + replies) in one batch.
    const authorIds = new Set<string>();
    for (const n of notes) {
      authorIds.add(n.createdById);
      for (const r of n.replies ?? []) authorIds.add(r.createdById);
    }
    const profiles = await this._users.getPublicProfilesByIds([...authorIds]);

    return notes.map((n) => this._shape(n, profiles, userId));
  }

  private _shape(
    note: NoteRow,
    profiles: Map<
      string,
      { id: string; name: string; email: string; avatarUrl: string | null }
    >,
    userId: string
  ): any {
    const author = profiles.get(note.createdById) ?? null;

    const grouped = new Map<string, { count: number; reactedByMe: boolean }>();
    for (const r of note.reactions ?? []) {
      const g = grouped.get(r.emoji) ?? { count: 0, reactedByMe: false };
      g.count += 1;
      if (r.userId === userId) g.reactedByMe = true;
      grouped.set(r.emoji, g);
    }
    const reactions = [...grouped.entries()].map(([emoji, g]) => ({
      emoji,
      count: g.count,
      reactedByMe: g.reactedByMe,
    }));

    return {
      id: note.id,
      content: note.content,
      createdById: note.createdById,
      parentId: note.parentId,
      pinned: note.pinned,
      resolvedAt: note.resolvedAt,
      editedAt: note.editedAt,
      createdAt: note.createdAt,
      isOwn: note.createdById === userId,
      author: author
        ? { id: author.id, name: author.name, avatarUrl: author.avatarUrl }
        : null,
      reactions,
      replies: (note.replies ?? []).map((r) => this._shape(r, profiles, userId)),
    };
  }

  async create(params: {
    campaignId: string;
    organizationId: string;
    userId: string;
    content: string;
    parentId?: string;
    mentions?: string[];
  }) {
    await this._requireCampaign(params.campaignId, params.organizationId);

    const content = sanitizeNoteHtml(params.content);
    if (this._isEmpty(content)) {
      throw new BadRequestException('Note content is empty');
    }

    // Threading: a reply's parent must exist in this campaign and be top-level.
    if (params.parentId) {
      const parent = await this._notes.findById(
        params.parentId,
        params.organizationId
      );
      if (!parent || parent.campaignId !== params.campaignId) {
        throw new BadRequestException('Parent note not found');
      }
      if (parent.parentId) {
        throw new BadRequestException('Replies can only be one level deep');
      }
    }

    // Derive mentions from the note HTML itself (union with any client-sent ids),
    // so mentions in replies/edits work uniformly and a client can't suppress a
    // notification by omitting the array. Then keep only real org members (never
    // ping cross-org ids).
    const memberIds = await this._orgMemberIds(params.organizationId);
    const mentions = [
      ...new Set([
        ...(params.mentions ?? []),
        ...this._extractMentionIds(content),
      ]),
    ].filter((id) => memberIds.has(id));

    const note = await this._notes.create({
      campaignId: params.campaignId,
      organizationId: params.organizationId,
      createdById: params.userId,
      content,
      parentId: params.parentId ?? null,
      mentions,
    });

    await this._notifyMentionsAndReply(params, mentions).catch((err) =>
      this._logger.warn(`campaign-note notify failed: ${err?.message}`)
    );

    return note;
  }

  private async _notifyMentionsAndReply(
    params: {
      campaignId: string;
      organizationId: string;
      userId: string;
      parentId?: string;
    },
    mentions: string[]
  ) {
    const recipients = new Set(mentions);

    // Notify the parent author on a reply (if a real member and not the replier).
    if (params.parentId) {
      const parent = await this._notes.findById(
        params.parentId,
        params.organizationId
      );
      if (parent?.createdById) recipients.add(parent.createdById);
    }

    recipients.delete(params.userId); // never notify yourself
    if (recipients.size === 0) return;

    await this._notifications.notify({
      orgId: params.organizationId,
      category: 'comments',
      title: 'New campaign discussion note',
      message: 'You were mentioned in a campaign discussion.',
      link: `/campaigns/${params.campaignId}`,
      targetUserIds: [...recipients],
    });
  }

  async edit(
    noteId: string,
    campaignId: string,
    organizationId: string,
    userId: string,
    isSuperAdmin: boolean,
    content: string
  ) {
    const note = await this._loadOwned(
      noteId,
      campaignId,
      organizationId,
      userId,
      isSuperAdmin
    );
    const clean = sanitizeNoteHtml(content);
    if (this._isEmpty(clean)) {
      throw new BadRequestException('Note content is empty');
    }
    await this._notes.updateContent(note.id, organizationId, clean);
    return { success: true };
  }

  async remove(
    noteId: string,
    campaignId: string,
    organizationId: string,
    userId: string,
    isSuperAdmin: boolean
  ) {
    const note = await this._loadOwned(
      noteId,
      campaignId,
      organizationId,
      userId,
      isSuperAdmin
    );
    await this._notes.softDelete(note.id, organizationId);
    return { success: true };
  }

  async setPinned(
    noteId: string,
    campaignId: string,
    organizationId: string,
    pinned: boolean
  ) {
    await this._loadInCampaign(noteId, campaignId, organizationId);
    await this._notes.setPinned(noteId, organizationId, pinned);
    return { success: true };
  }

  async setResolved(
    noteId: string,
    campaignId: string,
    organizationId: string,
    userId: string,
    resolved: boolean
  ) {
    await this._loadInCampaign(noteId, campaignId, organizationId);
    await this._notes.setResolved(noteId, organizationId, resolved, userId);
    return { success: true };
  }

  async react(
    noteId: string,
    campaignId: string,
    organizationId: string,
    userId: string,
    emoji: string
  ) {
    await this._loadInCampaign(noteId, campaignId, organizationId);
    return this._notes.toggleReaction(noteId, userId, emoji, organizationId);
  }

  private async _loadInCampaign(
    noteId: string,
    campaignId: string,
    organizationId: string
  ) {
    const note = await this._notes.findById(noteId, organizationId);
    if (!note || note.campaignId !== campaignId) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }

  private async _loadOwned(
    noteId: string,
    campaignId: string,
    organizationId: string,
    userId: string,
    isSuperAdmin: boolean
  ) {
    const note = await this._loadInCampaign(noteId, campaignId, organizationId);
    if (note.createdById !== userId && !isSuperAdmin) {
      throw new ForbiddenException('You can only modify your own notes');
    }
    return note;
  }
}
