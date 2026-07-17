import { PrismaRepository, PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Post as PostBody } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import {
  CreationMethod,
  Post,
  Prisma,
  State,
} from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import utc from 'dayjs/plugin/utc';
import { v4 as uuidv4 } from 'uuid';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import { decryptPostIntegrationTokens } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration-token.utils';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);
dayjs.extend(isSameOrAfter);
dayjs.extend(utc);

@Injectable()
export class PostsRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _popularPosts: PrismaRepository<'popularPosts'>,
    private _comments: PrismaRepository<'comments'>,
    private _tags: PrismaRepository<'tags'>,
    private _tagsPosts: PrismaRepository<'tagsPosts'>,
    private _errors: PrismaRepository<'errors'>,
    private _socialComment: PrismaRepository<'socialComment'>,
    private _postCommentRead: PrismaRepository<'postCommentRead'>,
    private _transaction: PrismaTransaction
  ) {}

  private async _enrichWithUnreadComments(posts: any[], userId: string): Promise<void> {
    const postIds = posts.map(p => p.id);
    const unreadMap = new Map<string, number>();

    if (postIds.length > 0) {
      const unreadRows = await this._socialComment.$queryRaw<
        Array<{ post_id: string; unread: number }>
      >`
        SELECT
          sc."postId" AS post_id,
          COUNT(*)::int AS unread
        FROM "SocialComment" sc
        LEFT JOIN "PostCommentRead" pcr
          ON pcr."postId" = sc."postId" AND pcr."userId" = ${userId}
        WHERE
          sc."postId" IN (${Prisma.join(postIds)})
          AND sc."deletedAt" IS NULL
          AND sc."isOwn" = false
          AND (pcr."lastReadAt" IS NULL OR sc."platformCreatedAt" > pcr."lastReadAt")
        GROUP BY sc."postId"
      `;

      for (const { post_id, unread } of unreadRows) {
        unreadMap.set(post_id, unread);
      }
    }

    for (const post of posts) {
      (post as any).unreadComments = unreadMap.get(post.id) || 0;
    }
  }

  searchForMissingThreeHoursPosts() {
    return this._post.model.post.findMany({
      where: {
        integration: {
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
          deletedAt: null,
        },
        publishDate: {
          gte: dayjs.utc().subtract(2, 'day').toDate(),
          // 2.1: restore the 3-hour grace this "three hours" finder implied — only
          // recover posts overdue by >3h, so a run legitimately mid-publish (provider
          // 5xx backoff, slow media upload) at the top of the hour isn't cancelled.
          lt: dayjs.utc().subtract(3, 'hour').toDate(),
        },
        state: 'QUEUE',
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        organizationId: true,
        integration: {
          select: {
            providerIdentifier: true,
            // 4.13: include the pinned version so the recovery-enqueue path can
            // resolve the exact adapter (and reject a retired one).
            providerVersion: true,
          },
        },
        publishDate: true,
        settings: true,
      },
    });
  }

  getOldPosts(
    orgId: string,
    date: string,
    options?: { take?: number; page?: number }
  ) {
    const take = options?.take && options.take > 0 ? options.take : 100;
    const page = options?.page && options.page > 0 ? options.page : 1;
    return this._post.model.post.findMany({
      where: {
        integration: {
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
        },
        organizationId: orgId,
        publishDate: {
          lte: dayjs(date).toDate(),
        },
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: {
        publishDate: 'desc',
      },
      take,
      skip: (page - 1) * take,
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  updateImages(id: string, images: string, orgId: string) {
    return this._post.model.post.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        image: images,
      },
    });
  }

  getPostUrls(orgId: string, ids: string[]) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        releaseURL: true,
      },
    });
  }

  async getPosts(orgId: string, query: GetPostsDto, userId?: string) {
    // Use the provided start and end dates directly
    const startDate = dayjs.utc(query.startDate).toDate();
    // 4.3b: clamp the window server-side to ~92 days. A caller-supplied multi-year
    // range multiplied by a small `intervalInDays` in the expansion loop below would
    // otherwise generate an unbounded number of synthetic posts (DoS).
    const MAX_WINDOW_DAYS = 92;
    const requestedEnd = dayjs.utc(query.endDate);
    const maxEnd = dayjs.utc(startDate).add(MAX_WINDOW_DAYS, 'day');
    const endDate = (requestedEnd.isAfter(maxEnd) ? maxEnd : requestedEnd).toDate();

    const list = await this._post.model.post.findMany({
      where: {
        AND: [
          {
            OR: [
              {
                organizationId: orgId,
              },
            ],
          },
          {
            OR: [
              {
                publishDate: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                intervalInDays: {
                  not: null,
                },
              },
            ],
          },
        ],
        integration: {
          deletedAt: null,
          organizationId: orgId,
          // 4.3a: merge the customer filter into the existing integration relation
          // filter instead of replacing the whole object (which dropped deletedAt/org
          // scoping on the relation).
          ...(query.customer ? { customerId: query.customer } : {}),
        },
        deletedAt: null,
        parentPostId: null,
      },
      // 4.3b: bound the base row set feeding the interval expansion.
      take: 1000,
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        releaseId: true,
        state: true,
        intervalInDays: true,
        group: true,
        creationMethod: true,
        campaignId: true,
        approvalStatus: true,
        image: true,
        settings: true,
        lastViews: true,
        lastLikes: true,
        lastComments: true,
        commentCount: true,
        tags: {
          select: {
            tag: true,
          },
        },
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
            name: true,
            picture: true,
          },
        },
      },
    });

    const posts = list.reduce((all, post) => {
      if (!post.intervalInDays) {
        return [...all, post];
      }

      const addMorePosts = [];
      let startingDate = dayjs.utc(post.publishDate);
      while (dayjs.utc(endDate).isSameOrAfter(startingDate)) {
        if (dayjs(startingDate).isSameOrAfter(dayjs.utc(post.publishDate))) {
          addMorePosts.push({
            ...post,
            publishDate: startingDate.toDate(),
            actualDate: post.publishDate,
          });
        }

        startingDate = startingDate.add(post.intervalInDays, 'days');
      }

      return [...all, ...addMorePosts];
    }, [] as any[]);

    if (userId) {
      await this._enrichWithUnreadComments(posts, userId);
    }

    // Derive a compact media type from the (heavy) image JSON and the per-post
    // heading colour from `settings`, then strip the raw `image`/`settings` so the
    // calendar payload stays lean.
    return posts.map((post) => {
      const { image, settings, ...rest } = post;
      let color: string | null = null;
      if (settings) {
        try {
          color = JSON.parse(settings)?.color ?? null;
        } catch {
          color = null;
        }
      }
      return { ...rest, mediaType: this._computeMediaType(image), color };
    });
  }

  private _computeMediaType(imageJson?: string | null): 'none' | 'image' | 'video' {
    if (!imageJson) return 'none';
    try {
      const arr = JSON.parse(imageJson);
      if (!Array.isArray(arr) || arr.length === 0) return 'none';
      const isVideo = (m: any) =>
        typeof m?.path === 'string' && /(mp4|mov|webm|m4v|avi|mkv)(\?|#|$)/i.test(m.path);
      return arr.some(isVideo) ? 'video' : 'image';
    } catch {
      return 'none';
    }
  }

  // Sets the heading colour on every post in a group (stored in `settings` JSON).
  // A null/empty colour clears it (reverts to the default primary blue).
  async setGroupColor(orgId: string, group: string, color: string | null) {
    const posts = await this._post.model.post.findMany({
      where: { organizationId: orgId, group, deletedAt: null },
      select: { id: true, settings: true },
    });
    // 4.3f: batch the per-post updates into a single transaction instead of N awaited
    // round-trips.
    const updates = posts.map((post) => {
      let settings: any = {};
      try {
        settings = post.settings ? JSON.parse(post.settings) : {};
      } catch {
        settings = {};
      }
      if (color) settings.color = color;
      else delete settings.color;
      return this._post.model.post.update({
        where: { id: post.id, organizationId: orgId },
        data: { settings: JSON.stringify(settings) },
      });
    });
    if (updates.length) {
      await this._transaction.model.$transaction(updates);
    }
    return { color: color || null };
  }

  async getPostsList(orgId: string, query: GetPostsListDto, userId?: string) {
    const page = query.page || 0;
    const limit = query.limit || 20;
    const skip = page * limit;

    const stateFilter = query.state || 'all';
    const stateAndDate =
      stateFilter === 'scheduled'
        ? {
            state: State.QUEUE,
          }
        : stateFilter === 'draft'
        ? { state: State.DRAFT }
        : stateFilter === 'published'
        ? { state: State.PUBLISHED }
        : {
            state: {
              in: [State.QUEUE, State.DRAFT, State.PUBLISHED, State.ERROR],
            },
          };

    const orderDirection: 'asc' | 'desc' =
      stateFilter === 'published' ? 'desc' : 'asc';

    const where = {
      AND: [
        {
          OR: [
            {
              organizationId: orgId,
            },
          ],
        },
      ],
      ...stateAndDate,
      // Published posts were already posted (publishDate in the past), so fetch
      // all of them; everything else stays upcoming. Ordering handles the rest.
      ...(stateFilter === 'published'
        ? {}
        : { publishDate: { gte: dayjs.utc().toDate() } }),
      deletedAt: null as Date | null,
      parentPostId: null as string | null,
      intervalInDays: null as number | null,

      integration: {
        deletedAt: null as any,
        organizationId: orgId,
        ...(query.customer
          ? {
              customerId: query.customer,
            }
          : {}),
      },
    };

    const [posts, total] = await Promise.all([
      this._post.model.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          publishDate: orderDirection,
        },
        select: {
          id: true,
          content: true,
          publishDate: true,
          releaseURL: true,
          releaseId: true,
          state: true,
          intervalInDays: true,
          group: true,
          creationMethod: true,
          lastViews: true,
          lastLikes: true,
          lastComments: true,
          commentCount: true,
          tags: {
            select: {
              tag: true,
            },
          },
          integration: {
            select: {
              id: true,
              providerIdentifier: true,
              name: true,
              picture: true,
            },
          },
        },
      }),
      this._post.model.post.count({ where }),
    ]);

    if (userId) {
      await this._enrichWithUnreadComments(posts, userId);
    }

    return {
      posts,
      total,
      page,
      limit,
      hasMore: skip + posts.length < total,
    };
  }

  async deletePost(orgId: string, group: string) {
    await this._post.model.post.updateMany({
      where: {
        organizationId: orgId,
        group,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    return this._post.model.post.findFirst({
      where: {
        organizationId: orgId,
        group,
        parentPostId: null,
      },
      select: {
        id: true,
      },
    });
  }

  // No pagination/cap here on purpose: the `where: { group }` already bounds this to a single
  // group's posts, which feeds arrangePostsByGroup() to reconstruct the parent/child thread tree.
  // A page cap would silently truncate that tree. The unbounded per-org scan that D3 bounds is
  // getOldPosts (above), not this group-scoped read.
  getPostsByGroup(orgId: string, group: string) {
    return this._post.model.post.findMany({
      where: {
        group,
        organizationId: orgId,
        deletedAt: null,
      },
      include: {
        integration: true,
        tags: {
          select: {
            tag: true,
          },
        },
      },
    }).then((posts) => posts.map(decryptPostIntegrationTokens));
  }

  async getPost(
    id: string,
    organizationId: string,
    includeIntegration = false,
    isFirst?: boolean
  ) {
    const post = await this._post.model.post.findUnique({
      where: {
        id,
        organizationId,
        deletedAt: null,
      },
      include: {
        ...(includeIntegration
          ? {
              integration: true,
              tags: {
                select: {
                  tag: true,
                },
              },
            }
          : {}),
        childrenPost: true,
      },
    });
    return decryptPostIntegrationTokens(post);
  }

  updatePost(id: string, postId: string, releaseURL: string, orgId: string) {
    return this._post.model.post.update({
      where: {
        id,
        // 4.4a: org scoping is REQUIRED on the publish-path mutators — always
        // scope the write so a mis-threaded id can't touch another org's row.
        organizationId: orgId,
      },
      data: {
        state: 'PUBLISHED',
        releaseURL,
        releaseId: postId,
      },
    });
  }

  updatePostSettings(id: string, settings: string, orgId: string) {
    return this._post.model.post.update({
      where: {
        id,
        // 4.4a: org scoping is REQUIRED on the publish-path mutators.
        organizationId: orgId,
      },
      data: { settings },
    });
  }

  updateReleaseId(id: string, orgId: string, releaseId: string) {
    return this._post.model.post.update({
      where: {
        id,
        organizationId: orgId,
        releaseId: 'missing',
      },
      data: {
        releaseId: String(releaseId),
      },
    });
  }

  // 0.7: atomic publish state-claim. Flips exactly one QUEUE post to PUBLISHING and
  // returns the affected row count — the worker aborts the run when count === 0 so a
  // recovery enqueue racing a live run (or a "post now" during sleep) can't double-post.
  // D2: org-scoped so a leaked id cannot claim another tenant's post.
  async claimForPublish(id: string, orgId: string): Promise<number> {
    const { count } = await this._post.model.post.updateMany({
      where: { id, organizationId: orgId, state: 'QUEUE', deletedAt: null },
      data: { state: 'PUBLISHING' },
    });
    return count;
  }

  // 0.7 follow-up: recover posts orphaned in PUBLISHING by a terminal Inngest run
  // loss *after* the atomic claim (the claim moves QUEUE -> PUBLISHING, but if the
  // run then dies unrecoverably the row is stuck: the missing-post finder only
  // matches QUEUE). Reset stale PUBLISHING rows (same >3h grace / 2-day floor as the
  // finder) back to QUEUE so the finder re-enqueues them; the atomic claim on the
  // re-run — plus the `post/cancel` the recovery sends first — keeps it
  // double-publish-safe if the original run were somehow still alive.
  async resetStalePublishingToQueue(): Promise<number> {
    const { count } = await this._post.model.post.updateMany({
      where: {
        state: 'PUBLISHING',
        deletedAt: null,
        publishDate: {
          gte: dayjs.utc().subtract(2, 'day').toDate(),
          lt: dayjs.utc().subtract(3, 'hour').toDate(),
        },
      },
      data: { state: 'QUEUE' },
    });
    return count;
  }

  private _redactSensitive(value: string): string {
    const SENSITIVE_KEYS = [
      'token', 'accessToken', 'access_token', 'refreshToken', 'refresh_token',
      'apiKey', 'api_key', 'secret', 'password', 'Authorization',
      // 4.1a: compound keys added explicitly — the `\b${key}\b` boundary on `secret`
      // won't match inside `client_secret`, so the underscore-joined names need their own
      // entries. `cookie`/`set-cookie` and private-key variants likewise.
      'client_secret', 'clientSecret', 'cookie', 'set-cookie',
      'privateKey', 'private_key',
    ];
    let result = value;
    for (const key of SENSITIVE_KEYS) {
      const regex = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`, 'gi');
      result = result.replace(regex, `$1"[REDACTED]"`);
      const regex2 = new RegExp(`(\\b${key}\\b\\s*[:=]\\s*)[^\\s,;&"]+`, 'gi');
      result = result.replace(regex2, `$1[REDACTED]`);
    }
    return result;
  }

  async changeState(id: string, state: State, orgId: string, err?: any, body?: any) {
    const update = await this._post.model.post.update({
      where: {
        id,
        // 4.4a: org scoping is REQUIRED on the publish-path mutators — always
        // scope the write so a mis-threaded id can't touch another org's row.
        organizationId: orgId,
      },
      data: {
        state,
        ...(err
          ? { error: typeof err === 'string' ? this._redactSensitive(err) : this._redactSensitive(JSON.stringify(err)) }
          : {}),
      },
      include: {
        integration: {
          select: {
            providerIdentifier: true,
          },
        },
      },
    });

    if (state === 'ERROR' && err && body) {
      try {
        const safeErr = typeof err === 'string' ? err : this._redactSensitive(JSON.stringify(err));
        const safeBody = typeof body === 'string' ? body : this._redactSensitive(JSON.stringify(body));
        await this._errors.model.errors.create({
          data: {
            message: safeErr,
            organizationId: update.organizationId,
            platform: update.integration.providerIdentifier,
            postId: update.id,
            body: safeBody,
          },
        });
      } catch (err) {}
    }

    return update;
  }

  getErrorsByPostIds(postIds: string[]) {
    return this._errors.model.errors.findMany({
      where: {
        postId: { in: postIds },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    isDraft: boolean,
    action: 'schedule' | 'update' = 'schedule'
  ) {
    return this._post.model.post.update({
      where: {
        organizationId: orgId,
        id,
      },
      data: {
        publishDate: dayjs(date).toDate(),
        // schedule: set state to QUEUE (or DRAFT if it was a draft)
        // update: don't change the state
        ...(action === 'schedule'
          ? {
              state: isDraft ? 'DRAFT' : 'QUEUE',
              releaseId: null,
              releaseURL: null,
            }
          : {}),
      },
    });
  }

  countPostsFromDay(orgId: string, date: Date) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: date,
        },
        OR: [
          {
            deletedAt: null,
            state: {
              in: ['QUEUE'],
            },
          },
          {
            // 4.3e: exclude soft-deleted rows from the PUBLISHED branch too, so a
            // deleted post isn't counted against the quota (the QUEUE branch already
            // filtered it). Quota semantic: deleting a *scheduled* post frees its slot.
            deletedAt: null,
            state: 'PUBLISHED',
          },
        ],
      },
    });
  }

  async createOrUpdatePost(
    state: 'draft' | 'schedule' | 'now' | 'update',
    orgId: string,
    date: string,
    body: PostBody,
    tags: { value: string; label: string }[],
    creationMethod: CreationMethod,
    inter?: number,
    campaignId?: string,
    brandId?: string,
  ) {
    const posts: Prisma.PostGetPayload<{
      select: {
        id: true;
        state: true;
        integration: {
          select: {
            id: true;
            providerIdentifier: true;
            providerVersion: true;
          };
        };
      };
    }>[] = [];
    const uuid = uuidv4();

    for (const value of body.value) {
      const updateData = (type: 'create' | 'update') => ({
        publishDate: dayjs(date).toDate(),
        integration: {
          connect: {
            id: body.integration.id,
            organizationId: orgId,
          },
        },
        ...(posts?.[posts.length - 1]?.id
          ? {
              parentPost: {
                connect: {
                  id: posts[posts.length - 1]?.id,
                },
              },
            }
          : type === 'update'
          ? {
              parentPost: {
                disconnect: true,
              },
            }
          : {}),
        content: value.content,
        delay: value.delay || 0,
        group: uuid,
        intervalInDays: inter ? +inter : null,

        ...(type === 'create' ? { creationMethod } : {}),
        ...(state === 'update'
          ? {}
          : {
              state:
                state === 'draft' ? ('DRAFT' as const) : ('QUEUE' as const),
            }),
        image: JSON.stringify(value.image),
        settings: JSON.stringify(body.settings),
        ...(state === 'draft' && campaignId ? { approvalStatus: 'pending' as const } : {}),
        organization: {
          connect: {
            id: orgId,
          },
        },
      });

      posts.push(
        await this._post.model.post.upsert({
          where: {
            // 0.1: org-scope the upsert key (extendedWhereUnique). A client-supplied
            // `value.id` belonging to another org fails this where and falls through to
            // `create` (which never sets `id`, so a fresh server cuid is minted) — closing
            // the cross-tenant hijack and id-squatting.
            id: value.id || uuidv4(),
            organizationId: orgId,
          },
          create: { ...updateData('create'), ...(campaignId ? { campaign: { connect: { id: campaignId } } } : {}), ...(brandId ? { brand: { connect: { id: brandId } } } : {}) },
          update: {
            ...updateData('update'),

          },
          select: {
            id: true,
            state: true,
            integration: {
              select: {
                id: true,
                providerIdentifier: true,
                providerVersion: true,
              },
            },
          },
        })
      );

      if (posts.length === 1) {
        await this._tagsPosts.model.tagsPosts.deleteMany({
          where: {
            post: {
              id: posts[0].id,
              organizationId: orgId,
            },
          },
        });

        if (tags.length) {
          const tagsList = await this._tags.model.tags.findMany({
            where: {
              orgId: orgId,
              deletedAt: null,
              name: {
                in: tags.map((tag) => tag.label).filter((f) => f),
              },
            },
          });

          if (tagsList.length) {
            await this._post.model.post.update({
              where: {
                id: posts[posts.length - 1].id,
                organizationId: orgId,
              },
              data: {
                tags: {
                  createMany: {
                    data: tagsList.map((tag) => ({
                      tagId: tag.id,
                    })),
                  },
                },
              },
            });
          }
        }
      }
    }

    const previousPost = body.group
      ? (
          await this._post.model.post.findFirst({
            where: {
              group: body.group,
              // 0.2: org-scope the group cleanup so a guessed foreign group uuid
              // can't leak a foreign post id or soft-delete another org's thread.
              organizationId: orgId,
              deletedAt: null,
              parentPostId: null,
            },
            select: {
              id: true,
            },
          })
        )?.id!
      : undefined;

    if (body.group) {
      await this._post.model.post.updateMany({
        where: {
          group: body.group,
          // 0.2: org-scope the group cleanup (see above).
          organizationId: orgId,
          deletedAt: null,
        },
        data: {
          parentPostId: null,
          deletedAt: new Date(),
        },
      });
    }

    return { previousPost, posts };
  }

  async getPostById(id: string, org: string) {
    const post = await this._post.model.post.findUnique({
      where: {
        id,
        organizationId: org,
      },
      include: {
        integration: true,
      },
    });
    return decryptPostIntegrationTokens(post);
  }

  findAllExistingCategories() {
    return this._popularPosts.model.popularPosts.findMany({
      select: {
        category: true,
      },
      distinct: ['category'],
    });
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
      },
      select: {
        topic: true,
      },
      distinct: ['topic'],
    });
  }

  findPopularPosts(category: string, topic?: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
        ...(topic ? { topic } : {}),
      },
      select: {
        content: true,
        hook: true,
      },
    });
  }

  createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._popularPosts.model.popularPosts.create({
      data: {
        category: post.category,
        topic: post.topic,
        content: post.content,
        hook: post.hook,
      },
    });
  }

  async getPostsCountsByDates(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs
  ) {
    const dates = await this._post.model.post.findMany({
      where: {
        deletedAt: null,
        organizationId: orgId,
        publishDate: {
          in: times.map((time) => {
            return date.clone().add(time, 'minutes').toDate();
          }),
        },
      },
      // 4.3e: only `publishDate` is read below — avoid fetching full (heavy) rows.
      select: { publishDate: true },
    });

    return times.filter(
      (time) =>
        date.clone().add(time, 'minutes').isAfter(dayjs.utc()) &&
        !dates.find((dateFind) => {
          return (
            dayjs
              .utc(dateFind.publishDate)
              .diff(date.clone().startOf('day'), 'minutes') == time
          );
        })
    );
  }

  async getComments(postId: string) {
    return this._comments.model.comments.findMany({
      where: {
        postId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async getTags(orgId: string) {
    return this._tags.model.tags.findMany({
      where: {
        orgId,
        deletedAt: null,
      },
    });
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._tags.model.tags.create({
      data: {
        orgId,
        name: body.name,
        color: body.color,
      },
    });
  }

  editTag(id: string, orgId: string, body: CreateTagDto) {
    return this._tags.model.tags.update({
      where: {
        // 0.3: org-scope the tag write (mirror deleteTag) — the orgId param was dead,
        // letting any user rename/recolor any org's tag by id. P2025 surfaces as 404.
        id,
        orgId,
      },
      data: {
        name: body.name,
        color: body.color,
      },
    });
  }

  deleteTag(id: string, orgId: string) {
    return this._tags.model.tags.update({
      where: {
        id,
        orgId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  createComment(
    orgId: string,
    userId: string,
    postId: string,
    content: string
  ) {
    return this._comments.model.comments.create({
      data: {
        organizationId: orgId,
        userId,
        postId,
        content,
      },
    });
  }

  async updateCommentCount(postId: string, count: number, orgId: string) {
    return this._post.model.post.update({
      where: { id: postId, organizationId: orgId },
      data: { commentCount: count },
    });
  }

  getPostByForWebhookId(postId: string, orgId: string) {
    return this._post.model.post.findMany({
      where: {
        id: postId,
        organizationId: orgId,
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  async getPostsSince(orgId: string, since: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: new Date(since),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  getTotalPostCount(orgId: string) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        parentPostId: null,
        integration: { deletedAt: null, organizationId: orgId },
      },
    });
  }

  getScheduledPostCount(orgId: string) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        state: State.QUEUE,
        publishDate: { gte: dayjs.utc().toDate() },
        deletedAt: null,
        parentPostId: null,
        integration: { deletedAt: null, organizationId: orgId },
      },
    });
  }

  getPublishedPostCountSince(orgId: string, since: Date) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        state: State.PUBLISHED,
        publishDate: { gte: since },
        deletedAt: null,
        parentPostId: null,
        integration: { deletedAt: null, organizationId: orgId },
      },
    });
  }

  getDraftPostCount(orgId: string) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        state: State.DRAFT,
        deletedAt: null,
        parentPostId: null,
        integration: { deletedAt: null, organizationId: orgId },
      },
    });
  }

  getFailedPosts(orgId: string, since: Date, limit: number) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        state: State.ERROR,
        deletedAt: null,
        parentPostId: null,
        updatedAt: { gte: since },
        integration: { deletedAt: null, organizationId: orgId },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        content: true,
        error: true,
        publishDate: true,
        updatedAt: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
          },
        },
      },
    });
  }

  getFailedPostCount(orgId: string, since: Date) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        state: State.ERROR,
        deletedAt: null,
        parentPostId: null,
        updatedAt: { gte: since },
        integration: { deletedAt: null, organizationId: orgId },
      },
    });
  }

  getTopPosts(orgId: string, since: Date, limit: number) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        state: State.PUBLISHED,
        deletedAt: null,
        parentPostId: null,
        publishDate: { gte: since },
        integration: { deletedAt: null, organizationId: orgId },
      },
      orderBy: { publishDate: 'desc' },
      take: 50,
      select: {
        id: true,
        content: true,
        publishDate: true,
        lastViews: true,
        lastLikes: true,
        lastComments: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
          },
        },
      },
    });
  }

  getPendingApprovalPosts(orgId: string, limit: number) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        state: State.DRAFT,
        approvalStatus: 'pending',
        deletedAt: null,
        parentPostId: null,
        integration: { deletedAt: null, organizationId: orgId },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        content: true,
        publishDate: true,
        createdAt: true,
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
          },
        },
      },
    });
  }

  getPendingApprovalPostCount(orgId: string) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        state: State.DRAFT,
        approvalStatus: 'pending',
        deletedAt: null,
        parentPostId: null,
        integration: { deletedAt: null, organizationId: orgId },
      },
    });
  }

  getScheduledPostDates(orgId: string, from: Date, to: Date) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        state: State.QUEUE,
        deletedAt: null,
        parentPostId: null,
        publishDate: { gte: from, lte: to },
        integration: { deletedAt: null, organizationId: orgId },
      },
      select: {
        publishDate: true,
      },
      orderBy: { publishDate: 'asc' },
    });
  }

  async retryPost(id: string, orgId: string, publishDate: Date) {
    return this._post.model.post.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        state: State.QUEUE,
        error: null,
        publishDate,
      },
      include: {
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
          },
        },
      },
    });
  }

  getCampaignDrafts(campaignId: string, orgId: string) {
    return this._post.model.post.findMany({
      where: {
        campaignId,
        organizationId: orgId,
        state: State.DRAFT,
        deletedAt: null,
        parentPostId: null,
        integration: { deletedAt: null, organizationId: orgId },
      },
      orderBy: { publishDate: 'asc' },
      include: {
        integration: { select: { id: true, name: true, providerIdentifier: true, picture: true } },
      },
    });
  }

  getCampaignPosts(campaignId: string, orgId: string) {
    return this._post.model.post.findMany({
      where: {
        campaignId,
        organizationId: orgId,
        deletedAt: null,
        parentPostId: null,
        integration: { deletedAt: null, organizationId: orgId },
      },
      orderBy: { publishDate: 'desc' },
      include: {
        integration: { select: { id: true, name: true, providerIdentifier: true, picture: true } },
      },
    });
  }

  async updateApprovalStatus(
    id: string,
    orgId: string,
    status: 'pending' | 'approved' | 'rejected',
    approvedById?: string
  ) {
    return this._post.model.post.updateMany({
      where: { id, organizationId: orgId, state: State.DRAFT },
      data: {
        approvalStatus: status,
        approvedById: status === 'approved' ? approvedById : null,
        approvedAt: status === 'approved' ? new Date() : null,
      },
    });
  }

  async setPostCampaign(id: string, orgId: string, campaignId: string | null) {
    return this._post.model.post.updateMany({
      where: { id, organizationId: orgId },
      data: { campaignId },
    });
  }

  getUpcomingPosts(orgId: string, limit: number) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        state: State.QUEUE,
        publishDate: { gte: dayjs.utc().toDate() },
        deletedAt: null,
        parentPostId: null,
        intervalInDays: null,
        integration: { deletedAt: null, organizationId: orgId },
      },
      orderBy: { publishDate: 'asc' },
      take: limit,
      select: {
        id: true,
        content: true,
        publishDate: true,
        integration: {
          select: {
            name: true,
            providerIdentifier: true,
            picture: true,
          },
        },
      },
    });
  }
}
