import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ParseCuidPipe } from '@gitroom/nestjs-libraries/pipes/parse-cuid.pipe';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import {
  LikeCommentDto,
  ReplyCommentDto,
} from '@gitroom/nestjs-libraries/dtos/social-comments/social.comment.dto';
import { GetInboxDto } from '@gitroom/nestjs-libraries/dtos/social-comments/get-inbox.dto';
import { BulkMarkReadDto } from '@gitroom/nestjs-libraries/dtos/social-comments/bulk-mark-read.dto';
import { UpdateCommentStatusDto } from '@gitroom/nestjs-libraries/dtos/social-comments/update-comment-status.dto';
import { AssignCommentDto } from '@gitroom/nestjs-libraries/dtos/social-comments/assign-comment.dto';
import { Organization, User } from '@prisma/client';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';

@Controller('/posts')
export class SocialCommentsController {
  constructor(private _socialCommentsService: SocialCommentsService) {}

  @Get('/inbox')
  async getInbox(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Query() query: GetInboxDto,
  ) {
    const filters = this._socialCommentsService.parseInboxFilters(query);
    return this._socialCommentsService.getInbox(org.id, user.id, filters);
  }

  @Post('/inbox/bulk-read')
  @RequirePermission('comments', 'update')
  async bulkMarkRead(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BulkMarkReadDto,
  ) {
    return this._socialCommentsService.bulkMarkRead(body.commentIds, org.id);
  }

  @Get('/inbox/unread-count')
  async getInboxUnreadCount(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._socialCommentsService.getInboxUnreadCount(org.id, user.id);
  }

  @Post('/inbox/sync')
  @RequirePermission('comments', 'update')
  async syncInbox(
    @GetOrgFromRequest() org: Organization,
  ) {
    return this._socialCommentsService.syncInbox(org.id);
  }

  @Get('/:id/social-comments')
  async getComments(
    @Param('id', ParseCuidPipe) id: string,
    @Query('cursor') cursor: string | undefined,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._socialCommentsService.getComments(org.id, user.id, id, cursor);
  }

  @Post('/:id/social-comments')
  @RequirePermission('comments', 'create')
  async addComment(
    @Param('id', ParseCuidPipe) id: string,
    @Body() body: ReplyCommentDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._socialCommentsService.addComment(
      org.id,
      user.id,
      id,
      body.message,
      org,
      user,
      idempotencyKey,
    );
  }

  @Post('/:id/social-comments/:commentId/reply')
  @RequirePermission('comments', 'create')
  async replyToComment(
    @Param('id', ParseCuidPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() body: ReplyCommentDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._socialCommentsService.replyToCommentGuarded(
      org.id,
      user.id,
      id,
      commentId,
      body.message,
      org,
      user,
      idempotencyKey,
    );
  }

  @Post('/:id/social-comments/:commentId/like')
  @RequirePermission('comments', 'update')
  async likeComment(
    @Param('id', ParseCuidPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() body: LikeCommentDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._socialCommentsService.likeComment(org.id, user.id, id, commentId, body.like);
  }

  @Post('/:id/social-comments/read')
  @RequirePermission('comments', 'update')
  async markAsRead(
    @Param('id', ParseCuidPipe) id: string,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._socialCommentsService.markAsRead(org.id, user.id, id);
  }

  @Post('/:id/social-comments/:commentId/status')
  @RequirePermission('comments', 'update')
  async updateCommentStatus(
    @Param('id', ParseCuidPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() body: UpdateCommentStatusDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._socialCommentsService.updateCommentStatus(org.id, user.id, id, commentId, body.status);
  }

  @Post('/:id/social-comments/:commentId/assign')
  @RequirePermission('comments', 'update')
  async assignComment(
    @Param('id', ParseCuidPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() body: AssignCommentDto,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._socialCommentsService.assignComment(org.id, user.id, id, commentId, body.assigneeId ?? null);
  }

  @Get('/:id/social-comments/unread-count')
  async getUnreadCount(
    @Param('id', ParseCuidPipe) id: string,
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    return this._socialCommentsService.getUnreadCount(org.id, user.id, id);
  }
}
