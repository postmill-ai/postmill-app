import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ParseCuidPipe } from '@gitroom/nestjs-libraries/pipes/parse-cuid.pipe';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { ValidatePostsDto } from '@gitroom/nestjs-libraries/dtos/posts/validate.posts.dto';
import { BulkCreatePostsDto } from '@gitroom/nestjs-libraries/dtos/posts/bulk.create.posts.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { ApiTags } from '@nestjs/swagger';
import { GeneratorDto } from '@gitroom/nestjs-libraries/dtos/generator/generator.dto';
import { CreateGeneratedPostsDto } from '@gitroom/nestjs-libraries/dtos/generator/create.generated.posts.dto';
import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';
import { BudgetExceeded } from '@gitroom/nestjs-libraries/ai/governance/errors';
import { Request, Response } from 'express';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import { CreateCommentDto } from '@gitroom/nestjs-libraries/dtos/posts/create.comment.dto';
import { SeparatePostsDto } from '@gitroom/nestjs-libraries/dtos/posts/separate.posts.dto';
import { ShouldShortlinkDto } from '@gitroom/nestjs-libraries/dtos/posts/should.shortlink.dto';
import { SetPostColorDto } from '@gitroom/nestjs-libraries/dtos/posts/set.post.color.dto';
import { ShortlinkActiveDto } from '@gitroom/nestjs-libraries/dtos/posts/shortlink-active.dto';
import { UpdateReleaseIdDto } from '@gitroom/nestjs-libraries/dtos/posts/update-release-id.dto';
import { ChangePostDateDto } from '@gitroom/nestjs-libraries/dtos/posts/change-post-date.dto';
import { Throttle } from '@nestjs/throttler';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';

@ApiTags('Posts')
@Controller('/posts')
@UseGuards(OrgRbacGuard)
export class PostsController {
  constructor(
    private _postsService: PostsService,
    private _agentGraphService: AgentGraphService,
    private _shortLinkService: ShortLinkService
  ) {}

  @Get('/:id/statistics')
  async getStatistics(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.getStatistics(org.id, id);
  }

  @Get('/:id/missing')
  async getMissingContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.getMissingContent(org.id, id);
  }

  @Put('/:id/release-id')
  @RequirePermission('posts', 'update')
  async updateReleaseId(
    @GetOrgFromRequest() org: Organization,
    @Param('id', ParseCuidPipe) id: string,
    @Body() body: UpdateReleaseIdDto
  ) {
    return this._postsService.updateReleaseId(org.id, id, body.releaseId);
  }

  @Post('/:id/retry')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async retryPost(
    @GetOrgFromRequest() org: Organization,
    @Param('id', ParseCuidPipe) id: string,
  ) {
    return this._postsService.retryPost(org.id, id);
  }

  @Post('/should-shortlink')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async shouldShortlink(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ShouldShortlinkDto
  ) {
    return this._shortLinkService.shouldShortlink(org.id, body.messages);
  }

  // Member-safe list of the org's configured short-link providers + the active
  // one, for the composer's provider picker (the /settings/shortlinks routes are
  // admin-gated). Read-only — org-scoped by the guard, no extra permission.
  @Get('/shortlink-providers')
  async shortlinkProviders(@GetOrgFromRequest() org: Organization) {
    return this._shortLinkService.listSelectableProviders(org.id);
  }

  // Sets the org's active short-link provider from the composer. Gated to the
  // compose capability (posts:update), not admin — note this changes the active
  // provider org-wide.
  @Post('/shortlink-active')
  @RequirePermission('posts', 'update')
  async setShortlinkActive(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ShortlinkActiveDto
  ) {
    try {
      return await this._shortLinkService.setActiveProvider(
        org.id,
        body.identifier
      );
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Post('/:id/comments')
  @RequirePermission('comments', 'create')
  async createComment(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: CreateCommentDto
  ) {
    // Org scoping is passed to the service; post-ownership (404-on-null for a
    // post outside this org) is enforced on the service/repository path.
    return this._postsService.createComment(org.id, user.id, id, body.comment);
  }

  @Get('/tags')
  async getTags(@GetOrgFromRequest() org: Organization) {
    return { tags: await this._postsService.getTags(org.id) };
  }

  @Post('/tags')
  @RequirePermission('posts', 'update')
  async createTag(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTagDto
  ) {
    return this._postsService.createTag(org.id, body);
  }

  @Put('/tags/:id')
  @RequirePermission('posts', 'update')
  async editTag(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTagDto,
    @Param('id') id: string
  ) {
    return this._postsService.editTag(id, org.id, body);
  }

  @Delete('/tags/:id')
  @RequirePermission('posts', 'update')
  async deleteTag(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.deleteTag(id, org.id);
  }

  @Get('/')
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsDto,
    @GetUserFromRequest() user: User,
  ) {
    return this._postsService.getPostsMinified(org.id, query, user.id);
  }

  @Get('/find-slot')
  async findSlot(@GetOrgFromRequest() org: Organization) {
    return { date: await this._postsService.findFreeDateTime(org.id) };
  }

  @Get('/find-slot/:id')
  async findSlotIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id?: string
  ) {
    return { date: await this._postsService.findFreeDateTime(org.id, id) };
  }

  @Get('/list')
  async getPostsList(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsListDto,
    @GetUserFromRequest() user: User,
  ) {
    return this._postsService.getPostsList(org.id, query, user.id);
  }

  @Get('/old')
  oldPosts(
    @GetOrgFromRequest() org: Organization,
    @Query('date') date: string,
    @Query('page') page?: string
  ) {
    return this._postsService.getOldPosts(org.id, date, this.parsePage(page));
  }

  @Get('/group/:group/debug-export')
  @RequirePermission('posts', 'manage')
  async getPostGroupDebugExport(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    return this._postsService.getPostGroupDebugExport(org.id, group);
  }

  @Get('/group/:group')
  getPostsByGroup(@GetOrgFromRequest() org: Organization, @Param('group') group: string) {
    return this._postsService.getPostsByGroup(org.id, group);
  }

  // Parse + clamp an optional `page` query param (1..1000) into the options shape getOldPosts
  // accepts, so `/posts/old` (an unbounded per-org scan) can never be driven past a sane
  // ceiling. Returns `undefined` when absent so the service / repository fall back to page 1
  // with the default page size.
  private parsePage(page?: string): { page: number } | undefined {
    if (page === undefined) return undefined;
    const parsed = Number.parseInt(page, 10);
    if (Number.isNaN(parsed) || parsed < 1) return { page: 1 };
    return { page: Math.min(parsed, 1000) };
  }

  @Get('/:id')
  getPost(
    @GetOrgFromRequest() org: Organization,
    @Param('id', ParseCuidPipe) id: string
  ) {
    return this._postsService.getPost(org.id, id);
  }

  @Post('/valid')
  async validatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ValidatePostsDto
  ) {
    return this._postsService.validatePosts(org.id, body?.posts || []);
  }

  @Post('/')
  @RequirePermission('posts', 'create')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async createPost(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreatePostDto
  ) {
    return this._postsService.validateAndCreatePost(org.id, body, 'WEB');
  }

  @Post('/generator/draft')
  @RequirePermission('posts', 'create')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  generatePostsDraft(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateGeneratedPostsDto
  ) {
    return this._postsService.generatePostsDraft(org.id, body);
  }

  @Post('/generator')
  @RequirePermission('posts', 'create')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async generatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GeneratorDto,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response
  ) {
    // Gate/build the run BEFORE streaming so a budget (or other pre-flight) throw
    // is a clean status code, not a truncated NDJSON body.
    let stream: AsyncIterable<unknown>;
    try {
      stream = await this._agentGraphService.start(org.id, body);
    } catch (err: any) {
      const status = err instanceof BudgetExceeded ? 429 : 500;
      res
        .status(status)
        .json({ error: err?.message ?? 'Generator failed to start' });
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    // Stop generating if the client (e.g. the wizard tab) disconnects.
    let clientGone = false;
    req.on('close', () => {
      clientGone = true;
    });

    try {
      for await (const event of stream) {
        if (clientGone || res.writableEnded || res.destroyed) break;
        res.write(JSON.stringify(event) + '\n');
      }
    } catch (err: any) {
      // A node throw mid-iteration (e.g. a configured output-guardrail block).
      // Emit a final error line instead of an abruptly truncated stream.
      if (!res.writableEnded && !res.destroyed) {
        res.write(
          JSON.stringify({ error: err?.message ?? 'Generation failed' }) + '\n'
        );
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  @Delete('/:group')
  @RequirePermission('posts', 'delete')
  deletePost(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    return this._postsService.deletePost(org.id, group);
  }

  @Put('/group/:group/color')
  @RequirePermission('posts', 'update')
  setGroupColor(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string,
    @Body() body: SetPostColorDto
  ) {
    return this._postsService.setGroupColor(org.id, group, body.color || null);
  }

  @Put('/:id/date')
  @RequirePermission('posts', 'update')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  changeDate(
    @GetOrgFromRequest() org: Organization,
    @Param('id', ParseCuidPipe) id: string,
    @Body() body: ChangePostDateDto
  ) {
    return this._postsService.changeDate(
      org.id,
      id,
      body.date,
      body.action ?? 'schedule'
    );
  }

  @Post('/preflight')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async preflightCheck(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ValidatePostsDto
  ) {
    return this._postsService.preflightCheck(org.id, body);
  }

  @Post('/bulk')
  @RequirePermission('posts', 'create')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async bulkCreate(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BulkCreatePostsDto,
  ) {
    return this._postsService.bulkCreate(org.id, body);
  }

  @Post('/separate-posts')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async separatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SeparatePostsDto
  ) {
    return this._postsService.separatePosts(body.content, body.len);
  }
}
