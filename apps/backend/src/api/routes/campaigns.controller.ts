import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { Response } from 'express';
import dayjs from 'dayjs';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { ApiTags } from '@nestjs/swagger';
import { CampaignsService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.service';
import { CampaignTagService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-item.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { CampaignReportService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-report.service';
import { CampaignNoteService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-note.service';
import {
  validateDateRange,
  validateToGteFrom,
  validateWindowCap,
} from '@gitroom/nestjs-libraries/analytics/date-range.validation';
import { CampaignItemDto } from '@gitroom/nestjs-libraries/dtos/campaigns/campaign-item.dto';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { CopyCampaignDto } from '@gitroom/nestjs-libraries/dtos/campaigns/copy-campaign.dto';
import { PromoteDraftsDto } from '@gitroom/nestjs-libraries/dtos/campaigns/promote-drafts.dto';
import { CampaignGoalDto } from '@gitroom/nestjs-libraries/dtos/campaigns/campaign-goals.dto';
import { CreateCampaignDto } from '@gitroom/nestjs-libraries/dtos/campaigns/create-campaign.dto';
import { UpdateCampaignDto } from '@gitroom/nestjs-libraries/dtos/campaigns/update-campaign.dto';
import { CreateCampaignNoteDto } from '@gitroom/nestjs-libraries/dtos/campaigns/create-campaign-note.dto';
import { UpdateCampaignNoteDto } from '@gitroom/nestjs-libraries/dtos/campaigns/update-campaign-note.dto';
import { NotePinDto } from '@gitroom/nestjs-libraries/dtos/campaigns/note-pin.dto';
import { NoteResolveDto } from '@gitroom/nestjs-libraries/dtos/campaigns/note-resolve.dto';
import { NoteReactionDto } from '@gitroom/nestjs-libraries/dtos/campaigns/note-reaction.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';

// J2 — hard cap for the campaigns list (default page size == max).
const CAMPAIGNS_MAX_LIMIT = 100;

@ApiTags('Campaigns')
@Controller('/campaigns')
export class CampaignsController {
  constructor(
    private _campaignsService: CampaignsService,
    private _campaignTagService: CampaignTagService,
    private _postsService: PostsService,
    private _reportService: CampaignReportService,
    private _noteService: CampaignNoteService,
    private _analyticsService: AnalyticsService,
  ) {}

  private _parseGoals(goals?: CampaignGoalDto[]): any {
    if (!goals) return undefined;
    return goals.map((g) => ({ metric: g.metric, target: Number(g.target) }));
  }

  // Reverse lookup for the per-entity Campaign selector. Declared before `/:id`
  // routes (different segment count, but keep it explicit).
  @Get('/for/:entityType/:entityId')
  @CheckPolicies([AuthorizationActions.Read, Sections.POSTS_PER_MONTH])
  async campaignsForItem(
    @GetOrgFromRequest() org: Organization,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string
  ) {
    return this._campaignTagService.listCampaignsForItem(org.id, entityType, entityId);
  }

  @Get('/')
  @CheckPolicies([AuthorizationActions.Read, Sections.POSTS_PER_MONTH])
  async list(
    @GetOrgFromRequest() org: Organization,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    // J2 — bound the previously-unbounded campaigns list. Back-compat: the
    // response is still a plain array; absent paging params we cap at the hard
    // max rather than returning everything. Pagination is now pushed to the
    // repository so the full list is not loaded into memory.
    const offset = Math.max(0, parseInt(cursor ?? '0', 10) || 0);
    const size = Math.min(
      CAMPAIGNS_MAX_LIMIT,
      Math.max(1, parseInt(limit ?? '', 10) || CAMPAIGNS_MAX_LIMIT),
    );
    return this._campaignsService.listPaged(org.id, size, offset);
  }

  @Get('/:id')
  @CheckPolicies([AuthorizationActions.Read, Sections.POSTS_PER_MONTH])
  async get(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._campaignsService.get(id, org.id);
  }

  @Post('/')
  @RequirePermission('posts', 'create')
  @CheckPolicies([AuthorizationActions.Create, Sections.CAMPAIGNS])
  async create(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreateCampaignDto,
  ) {
    return this._campaignsService.create({
      organizationId: org.id,
      name: body.name,
      color: body.color,
      description: body.description,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      utmEnabled: body.utmEnabled,
      client: body.client,
      project: body.project,
      tags: body.tags,
      goals: this._parseGoals(body.goals),
      createdById: user?.id,
    });
  }

  @Put('/:id')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateCampaignDto,
  ) {
    return this._campaignsService.update(id, org.id, {
      name: body.name,
      color: body.color,
      description: body.description,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      archived: body.archived,
      utmEnabled: body.utmEnabled,
      client: body.client,
      project: body.project,
      tags: body.tags,
      goals: this._parseGoals(body.goals),
    });
  }

  @Get('/:id/engagement')
  @CheckPolicies([AuthorizationActions.Read, Sections.POSTS_PER_MONTH])
  async getEngagement(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._campaignsService.getEngagement(id, org.id);
  }

  @Get('/:id/dashboard')
  @CheckPolicies([AuthorizationActions.Read, Sections.POSTS_PER_MONTH])
  async getDashboard(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._campaignsService.getDashboard(id, org.id);
  }

  // Campaign-hub analytics (1.5): real post-snapshot analytics for the campaign
  // via controller composition — org-ownership check on CampaignsService, then
  // AnalyticsService scoped to this campaign's posts.
  @Get('/:id/analytics')
  @CheckPolicies([AuthorizationActions.Read, Sections.POSTS_PER_MONTH])
  async getAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ) {
    const campaign = await this._campaignsService.get(id, org.id);
    if (!campaign) throw new NotFoundException('Campaign not found');

    // Default window: last 90 days (D5 — until the Phase-6 weekly rollup lands,
    // series are bounded to the 90-day post-snapshot retention). Callers may
    // narrow it with from/to.
    const to = toStr || dayjs().format('YYYY-MM-DD');
    const from = fromStr || dayjs().subtract(90, 'day').format('YYYY-MM-DD');

    // R2.4 — validate the resolved window before any downstream dayjs use, and
    // cap it so a public/large range can't blow up query cost.
    validateDateRange(from, to);
    validateToGteFrom(from, to);
    validateWindowCap(from, to);

    const overview = await this._analyticsService.getOverview(
      org,
      from,
      to,
      [],
      false,
      { campaignIds: [id] },
    );

    return { ...overview, window: { from, to } };
  }

  @Get('/:id/files')
  @CheckPolicies([AuthorizationActions.Read, Sections.POSTS_PER_MONTH])
  async getCampaignFiles(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._campaignsService.getCampaignFiles(id, org.id);
  }

  @Get('/:id/report')
  @CheckPolicies([AuthorizationActions.Read, Sections.POSTS_PER_MONTH])
  async getReport(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('format') format: 'json' | 'csv' | 'pdf' = 'json',
    @Res({ passthrough: true }) res: Response,
  ) {
    return this._reportService.dispatchReport(id, org.id, format, res);
  }

  @Post('/:id/copy')
  @RequirePermission('posts', 'create')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async copy(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: CopyCampaignDto,
  ) {
    return this._campaignsService.copy(id, org.id, user?.id, body);
  }

  @Get('/:id/drafts')
  @CheckPolicies([AuthorizationActions.Read, Sections.POSTS_PER_MONTH])
  async getDrafts(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._postsService.getCampaignDrafts(org.id, id);
  }

  @Post('/:id/drafts')
  @RequirePermission('posts', 'create')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async createDraft(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: CreatePostDto,
  ) {
    return this._postsService.validateAndCreatePost(
      org.id,
      { ...body, type: 'draft', campaignId: id } as CreatePostDto,
      'WEB',
    );
  }

  @Post('/:id/drafts/:postId/approve')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async approveDraft(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Param('postId') postId: string,
  ) {
    const post = await this._postsService.getPostById(postId, org.id);
    if (!post || post.campaignId !== id) {
      throw new ForbiddenException('Post does not belong to this campaign');
    }
    return this._postsService.approveDraft(org.id, postId, user.id);
  }

  @Post('/:id/drafts/:postId/reject')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async rejectDraft(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Param('postId') postId: string,
  ) {
    const post = await this._postsService.getPostById(postId, org.id);
    if (!post || post.campaignId !== id) {
      throw new ForbiddenException('Post does not belong to this campaign');
    }
    return this._postsService.rejectDraft(org.id, postId, user.id);
  }

  @Post('/:id/promote')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async promoteDrafts(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: PromoteDraftsDto,
  ) {
    const result = await this._postsService.promoteDrafts(org.id, id, body.postIds, user.id);
    return result;
  }

  @Post('/:id/share')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async enableShare(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._campaignsService.mintShareToken(id, org.id);
  }

  @Delete('/:id/share')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async disableShare(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    await this._campaignsService.disableShare(id, org.id);
    return { success: true };
  }

  @Delete('/:id')
  @RequirePermission('posts', 'delete')
  @CheckPolicies([AuthorizationActions.Delete, Sections.POSTS_PER_MONTH])
  async delete(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    await this._campaignsService.remove(id, org.id);
    return { success: true };
  }

  // ── Tagging: associate any of the 9 entity types with a campaign ──
  @Get('/:id/items')
  @CheckPolicies([AuthorizationActions.Read, Sections.POSTS_PER_MONTH])
  async listItems(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._campaignTagService.listItems(org.id, id);
  }

  @Post('/:id/items')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async tagItem(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: CampaignItemDto
  ) {
    return this._campaignTagService.tagItem(org.id, id, user?.id, body.entityType, body.entityId);
  }

  @Delete('/:id/items/:entityType/:entityId')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async untagItem(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string
  ) {
    return this._campaignTagService.untagItem(org.id, id, user?.id, entityType, entityId);
  }

  // ── Discussion: internal Jira-style note thread on a campaign ──
  @Get('/:id/notes')
  @CheckPolicies([AuthorizationActions.Read, Sections.POSTS_PER_MONTH])
  async listNotes(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
  ) {
    return this._noteService.list(id, org.id, user?.id);
  }

  @Post('/:id/notes')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async createNote(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: CreateCampaignNoteDto,
  ) {
    return this._noteService.create({
      campaignId: id,
      organizationId: org.id,
      userId: user?.id,
      content: body.content,
      parentId: body.parentId,
      mentions: body.mentions,
    });
  }

  @Put('/:id/notes/:noteId')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async editNote(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() body: UpdateCampaignNoteDto,
  ) {
    return this._noteService.edit(
      noteId,
      id,
      org.id,
      user?.id,
      !!user?.isSuperAdmin,
      body.content,
    );
  }

  @Delete('/:id/notes/:noteId')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async deleteNote(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
  ) {
    return this._noteService.remove(
      noteId,
      id,
      org.id,
      user?.id,
      !!user?.isSuperAdmin,
    );
  }

  @Post('/:id/notes/:noteId/pin')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async pinNote(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() body: NotePinDto,
  ) {
    return this._noteService.setPinned(noteId, id, org.id, body.pinned);
  }

  @Post('/:id/notes/:noteId/resolve')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async resolveNote(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() body: NoteResolveDto,
  ) {
    return this._noteService.setResolved(noteId, id, org.id, user?.id, body.resolved);
  }

  @Post('/:id/notes/:noteId/reactions')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Update, Sections.POSTS_PER_MONTH])
  async reactNote(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() body: NoteReactionDto,
  ) {
    return this._noteService.react(noteId, id, org.id, user?.id, body.emoji);
  }
}
