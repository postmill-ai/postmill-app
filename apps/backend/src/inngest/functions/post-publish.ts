import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { PostActivity } from '@gitroom/nestjs-libraries/inngest/activities/post.activity';
import {
  RefreshTokenError,
  BadBodyError,
} from '@gitroom/nestjs-libraries/inngest/errors';
import { providerModules } from '@gitroom/backend/providers.generated';
import { SocialProvider } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { capitalize, sortBy } from 'lodash';

const MAX_RETRIES = 5;

// Minimal runtime context for the metadata-only bridge used to derive task
// queues. The bridge only exposes `identifier`/`maxConcurrentJob` getters here,
// so a stub context is sufficient.
const taskQueueContext = {
  credentials: {},
  encryption: { encrypt: () => '', decrypt: () => '' },
  fetch: async () => new Response(),
  logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  telemetry: { recordCall: () => {} },
} as any;

/**
 * Temporal enforced a per-provider task queue with `maxConcurrentTaskExecutions`.
 * Inngest's `concurrency.limit` is static per function definition, so we generate
 * one function per unique task-queue (provider base identifier) and use the most
 * conservative `maxConcurrentJob` when multiple provider variants share a queue
 * (e.g. `instagram` and `instagram-standalone` both map to `instagram`).
 *
 * Sourced from the generated provider modules (the same single source of truth
 * the ProviderKernel registers from) — the kernel itself isn't populated until
 * app bootstrap, after Inngest functions are built, so we resolve the metadata
 * bridge directly from each module's `create()` rather than through the kernel.
 */
const taskQueueLimits = providerModules.reduce((acc, mod) => {
  if (mod.manifest.domain !== 'social') {
    return acc;
  }
  const capability = mod.create(taskQueueContext) as SocialProvider | undefined;
  if (!capability) {
    return acc;
  }
  const base = capability.identifier.split('-')[0].toLowerCase();
  const limit = capability.maxConcurrentJob ?? 1;
  const existing = acc.get(base);
  if (existing === undefined || limit < existing) {
    acc.set(base, limit);
  }
  return acc;
}, new Map<string, number>());

const runPostPublish = (postActivity: PostActivity) =>
  async ({ step, event }: any) => {
    const { postId, organizationId, taskQueue, maxConcurrentJob, postNow = false } = event.data;
    const startTime = new Date();

    const firstPost = await step.run('get-post', () =>
      postActivity.getPost(organizationId, postId)
    );

    if (!firstPost) {
      await step.run('mark-error-no-post', () =>
        postActivity.changeState(postId, 'ERROR', organizationId, 'No Post')
      );
      return;
    }

    if (!postNow && (firstPost as any).state !== 'QUEUE') {
      // 4.4c — a duplicate/stale event on an already-PUBLISHED post is a no-op;
      // never flip a live post back to ERROR. Only QUEUE/DRAFT are unexpected here.
      if ((firstPost as any).state === 'PUBLISHED') {
        return;
      }
      await step.run('mark-error-already-posted', () =>
        postActivity.changeState(
          (firstPost as any).id,
          'ERROR',
          organizationId,
          'Already posted',
          [firstPost]
        )
      );
      return;
    }

    if (!postNow) {
      const publishDate = dayjs((firstPost as any).publishDate);
      const sleepMs = publishDate.isBefore(dayjs())
        ? 0
        : publishDate.diff(dayjs(), 'millisecond');
      await step.sleep('wait-until-publish-date', sleepMs);
    }

    // 0.7 — atomic publish claim. Repeat-posts re-enter the postNow path on an
    // already-PUBLISHED post, so they skip the QUEUE-requiring claim.
    const { repeat = false } = event.data;
    if (!repeat) {
      const claimed = await step.run('claim-publish', () =>
        postActivity.claimForPublish(postId, organizationId)
      );
      if (!claimed) {
        return;
      }
    }

    const postsListBefore = await step.run('get-posts-list', () =>
      postActivity.getPostsList(organizationId, postId)
    );
    const [post] = postsListBefore;

    if (!post) {
      await step.run('mark-error-no-post-list', () =>
        postActivity.changeState(postId, 'ERROR', organizationId, 'No Post')
      );
      return;
    }

    if (post.integration?.refreshNeeded) {
      await step.run('notify-refresh-needed', () =>
        postActivity.notifyChannelError(
          post.organizationId,
          post?.integration?.name ?? '',
          post.integration?.providerIdentifier ?? '',
          'refresh',
          post.id
        )
      );
      await step.run('mark-error-refresh-needed', () =>
        postActivity.changeState(
          postsListBefore[0].id,
          'ERROR',
          organizationId,
          'Refresh channel needed',
          postsListBefore
        )
      );
      return;
    }

    if (post.integration?.disabled) {
      await step.run('notify-disabled', () =>
        postActivity.notifyChannelError(
          post.organizationId,
          post?.integration?.name ?? '',
          post.integration?.providerIdentifier ?? '',
          'disabled',
          post.id
        )
      );
      await step.run('mark-error-disabled', () =>
        postActivity.changeState(
          postsListBefore[0].id,
          'ERROR',
          organizationId,
          'Channel disabled',
          postsListBefore
        )
      );
      return;
    }

    const toComment: boolean =
      postsListBefore.length === 1
        ? false
        : await step.run('is-commentable', () =>
            postActivity.isCommentable(post.integration)
          );

    const postsList = toComment ? postsListBefore : [postsListBefore[0]];
    const postsResults: any[] = [];

    postItems: for (let i = 0; i < postsList.length; i++) {
      const before = postsResults.length;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          if (i === 0) {
            const result = await step.run('post-social', () =>
              postActivity.postSocial(post.integration as Integration, [
                postsList[i],
              ])
            );
            postsResults.push(...result);
          } else {
            if (postsList[i].delay) {
              await step.sleep(
                'wait-comment-delay',
                60000 * Math.min(1440, Math.max(0, Number(postsList[i].delay ?? 0)))
              );
            }

            const result = await step.run('post-comment', () =>
              postActivity.postComment(
                postsResults[0].postId,
                postsResults.length === 1
                  ? undefined
                  : postsResults[i - 1].postId,
                post.integration,
                [postsList[i]]
              )
            );
            postsResults.push(...result);
          }

          await step.run('update-post', () =>
            postActivity.updatePost(
              postsList[i].id,
              postsResults[i].postId,
              postsResults[i].releaseURL,
              organizationId
            )
          );

          if (i === 0) {
            await step.run('notify-published', () =>
              postActivity.notifyPostPublished(
                post.integration.organizationId,
                capitalize(post.integration.providerIdentifier),
                postsResults[0].releaseURL,
                post.id
              )
            );
          }

          break;
        } catch (err) {
          if (
            err instanceof RefreshTokenError ||
            (err as any)?.name === 'RefreshTokenError'
          ) {
            // 2.5 — return ONLY a non-secret signal from this step. The rotated
            // token is persisted to the DB by refreshTokenWithCause; the retried
            // post-social step re-reads it via _withDecryptedIntegration. The
            // plaintext accessToken/refreshToken must never enter Inngest step
            // state, so the mapping happens INSIDE the step.run closure.
            const refresh = await step.run('refresh-token', async () => {
              const result = await postActivity.refreshTokenWithCause(
                post.integration,
                (err as any)?.message || ''
              );
              return {
                refreshed: !!(result && result.accessToken),
                ...(result && result.expiresIn
                  ? { expiresIn: result.expiresIn }
                  : {}),
              };
            });
            if (!refresh.refreshed) {
              await step.run('mark-error-refresh-failed', () =>
                postActivity.changeState(
                  postsList[0].id,
                  'ERROR',
                  organizationId,
                  err,
                  postsList
                )
              );
              return;
            }
            // 2.5 — do NOT copy the token into `post.integration` (that value
            // would ride into the next step's serialized state). The retried
            // post-social step re-reads the DB-persisted rotated token.
            continue;
          }

          // 2.3 — for a mid-thread (i>0) failure, mark ONLY the failed child ERROR
          // and leave the already-PUBLISHED root live; a root (i===0) failure marks
          // the whole group ERROR.
          const isRoot = i === 0;
          await step.run('mark-error', () =>
            postActivity.changeState(
              isRoot ? postsList[0].id : postsList[i].id,
              'ERROR',
              organizationId,
              err,
              isRoot ? postsList : [postsList[i]]
            )
          );

          // 2.3 — always notify on failure (not only for BadBodyError).
          await step.run('notify-post-failed', () =>
            postActivity.notifyPostFailed(
              post.organizationId,
              post?.integration?.name ?? '',
              post.id,
              isRoot ? undefined : 'comment',
              (err as any)?.message
            )
          );

          if (isRoot) {
            return;
          }

          // The root is published — stop posting further thread items but continue
          // to the post-loop steps (send-webhooks/plugs) for the live root.
          break postItems;
        }
      }

      if (postsResults.length === before) {
        return;
      }
    }

    // First Comment (2F/4.4d) — crash-safe: post the comment in one step, then
    // record the idempotency marker in a separate step via a partial JSON merge
    // against FRESH settings (not the pre-publish snapshot). The record step is
    // NOT swallowed — a failed write surfaces so a re-run can't double-post
    // (the memoized post-first-comment step will not re-execute the comment).
    const firstCommentPosted = await step.run(
      'post-first-comment',
      async () => {
        const parsedSettings = JSON.parse(post.settings || '{}');
        const firstComment = parsedSettings?.firstComment;
        const alreadyPosted =
          parsedSettings?.firstCommentPostedAt ||
          parsedSettings?.firstCommentId;

        if (!firstComment || alreadyPosted || postsResults.length === 0) {
          return null;
        }

        const supports = await postActivity.supportsFirstComment(
          post.integration
        );
        if (!supports) {
          await postActivity.notifyFirstCommentUnsupported(
            post.organizationId,
            capitalize(post.integration?.providerIdentifier ?? ''),
            post.id
          );
          return null;
        }

        try {
          const firstCommentResult = await postActivity.postFirstComment(
            postsResults[0].postId,
            post.integration,
            firstComment
          );
          const postedComment = Array.isArray(firstCommentResult)
            ? firstCommentResult[0]
            : undefined;
          return {
            firstCommentId: postedComment?.postId ?? null,
            firstCommentReleaseURL: postedComment?.releaseURL ?? null,
          };
        } catch (err) {
          await postActivity.notifyFirstCommentFailed(
            post.organizationId,
            capitalize(post.integration?.providerIdentifier ?? ''),
            post.id
          );
          return null;
        }
      }
    );

    if (firstCommentPosted) {
      await step.run('record-first-comment', async () => {
        const fresh = await postActivity.getPost(organizationId, postId);
        const freshSettings = JSON.parse(
          (fresh as any)?.settings || post.settings || '{}'
        );
        const updatedSettings = {
          ...freshSettings,
          firstCommentId: firstCommentPosted.firstCommentId,
          firstCommentReleaseURL: firstCommentPosted.firstCommentReleaseURL,
          firstCommentPostedAt: new Date().toISOString(),
        };
        await postActivity.updatePostSettings(
          postsList[0].id,
          JSON.stringify(updatedSettings),
          organizationId
        );
      });
    }

    await step.run('send-webhooks', () =>
      postActivity.sendWebhooks(
        postsList[0].id,
        post.organizationId,
        post.integration.id
      )
    );

    const internalPlugsList = await step.run('internal-plugs', () =>
      postActivity.internalPlugs(post.integration, JSON.parse(post.settings))
    );

    const globalPlugsList = await step.run('global-plugs', () =>
      postActivity.globalPlugs(post.integration)
    );

    const repeatPost = !post.intervalInDays
      ? []
      : [
          {
            type: 'repeat-post' as const,
            delay:
              post.intervalInDays * 24 * 60 * 60 * 1000 -
              (new Date().getTime() - startTime.getTime()),
          },
        ];

    let list = sortBy(
      [
        ...internalPlugsList,
        ...globalPlugsList.map((current: any) =>
          Array.from({ length: current.totalRuns }).map((_, idx) => ({
            ...current,
            delay: current.delay * (idx + 1),
          }))
        ).flat(),
        ...repeatPost,
      ],
      'delay'
    );

    let plugIndex = 0;
    while (list.length > 0) {
      const todo = list.shift();
      const currentIndex = plugIndex++;
      await step.sleep(`wait-plug-delay-${currentIndex}`, Math.max(0, Number(todo.delay ?? 0)));

      if (todo.type === 'internal-plug') {
        await step.run(`process-internal-plug-${currentIndex}`, async () => {
          let integration = post.integration;
          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
              await postActivity.processInternalPlug({
                ...todo,
                post: postsResults[0].postId,
              } as any);
              break;
            } catch (err) {
              if (err instanceof RefreshTokenError && attempt < MAX_RETRIES - 1) {
                integration = await postActivity.getIntegrationById(
                  organizationId,
                  todo.integration
                );
                const refresh = await postActivity.refreshTokenWithCause(
                  integration,
                  err?.message || ''
                );
                if (!refresh || !refresh.accessToken) {
                  break;
                }
                continue;
              }
              if (err instanceof BadBodyError) {
                break;
              }
              break;
            }
          }
        });
      }

      if (todo.type === 'global') {
        const process = await step.run(`process-global-plug-${currentIndex}`, async () => {
          const integration = post.integration;
          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
              return await postActivity.processPlug({
                ...todo,
                postId: postsResults[0].postId,
              } as any);
            } catch (err) {
              if (err instanceof RefreshTokenError && attempt < MAX_RETRIES - 1) {
                const refresh = await postActivity.refreshTokenWithCause(
                  integration,
                  err?.message || ''
                );
                if (!refresh || !refresh.accessToken) {
                  return false;
                }
                continue;
              }
              if (err instanceof BadBodyError) {
                return false;
              }
              return false;
            }
          }
          return false;
        });
        if (process) {
          list = list.filter((current: any) => current.plugId !== todo.plugId);
        }
      }

      if (todo.type === 'repeat-post') {
        await step.sendEvent(`repeat-post-${currentIndex}`, {
          name: 'post/publish',
          data: {
            taskQueue,
            postId,
            organizationId,
            maxConcurrentJob,
            postNow: true,
            // 0.7 — the post is already PUBLISHED here; skip the QUEUE-requiring claim.
            repeat: true,
          },
          // 4.4f — deterministic id so an executor retry can't emit a second event.
          // Uses the post creation timestamp rather than startTime so the id is
          // stable across retries and Inngest memoization boundaries.
          id: `post_${post.id}_repeat_${currentIndex}_${post.createdAt.getTime()}`,
        });
      }
    }
  };

export const createPostPublishFunctions = (postActivity: PostActivity) =>
  Array.from(taskQueueLimits.entries()).map(([taskQueue, limit]) =>
    inngest.createFunction(
      {
        id: `post-publish-${taskQueue}`,
        concurrency: { limit, key: 'event.data.organizationId' },
        cancelOn: [
          {
            event: 'post/cancel',
            if: 'async.data.postId == event.data.postId',
          },
        ],
      },
      { event: 'post/publish', if: `event.data.taskQueue == "${taskQueue}"` },
      runPostPublish(postActivity)
    )
  );
