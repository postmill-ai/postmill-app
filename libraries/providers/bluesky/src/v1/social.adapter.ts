import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialCommentAuthor,
  SocialCommentDTO,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/provider-kernel';
import {
  BskyAgent,
  RichText,
  AppBskyEmbedVideo,
  AppBskyVideoDefs,
  AtpAgent,
  BlobRef,
} from '@atproto/api';
import { Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import sharp from 'sharp';
import { Plug } from '@gitroom/helpers/decorators/plug.decorator';
import { timer } from '@gitroom/helpers/utils/timer';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { Rules } from '@gitroom/provider-kernel';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { safeFetch } from '@gitroom/provider-kernel';
import net from 'node:net';

import { metadata as providerMetadata } from './metadata';

// S-19: validate decoded callback payload before use.
function validateBlueskyCallback(value: unknown): { service: string; identifier: string; password: string } {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid callback');
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.service !== 'string' ||
    typeof body.identifier !== 'string' ||
    typeof body.password !== 'string' ||
    !body.service.trim() ||
    !body.identifier.trim() ||
    !body.password.trim()
  ) {
    throw new Error('Invalid callback');
  }
  let url: URL;
  try {
    url = new URL(body.service);
  } catch {
    throw new Error('Invalid service URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('Service URL must use HTTPS');
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || net.isIP(hostname)) {
    throw new Error('Invalid service hostname');
  }
  return {
    service: body.service,
    identifier: body.identifier,
    password: body.password,
  };
}
async function reduceImageBySize(url: string, maxSizeKB = 976) {
  try {
    // Routed through safeFetch so the image download is validated as a public
    // HTTPS URL and re-validated per redirect hop. This is a post media URL
    // (not a provider API host), so it does not use SocialAbstract.fetch();
    // per-channel VPN egress is therefore not applied. See README "Known proxy gap".
    const response = await safeFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    let imageBuffer = Buffer.from(arrayBuffer);

    // Use sharp to get the metadata of the image
    const metadata = await sharp(imageBuffer).metadata();
    let width = metadata.width!;
    let height = metadata.height!;

    // Resize iteratively until the size is below the threshold
    while (imageBuffer.length / 1024 > maxSizeKB) {
      width = Math.floor(width * 0.9); // Reduce dimensions by 10%
      height = Math.floor(height * 0.9);

      // Resize the image
      const resizedBuffer = await sharp(imageBuffer)
        .resize({ width, height })
        .toBuffer();

      imageBuffer = resizedBuffer;

      if (width < 10 || height < 10) break; // Prevent overly small dimensions
    }

    return { width, height, buffer: imageBuffer };
  } catch (error) {
    console.error(
      'Error processing image:',
      (error as Error)?.message || 'unknown'
    );
    throw error;
  }
}

async function uploadVideo(
  agent: AtpAgent,
  videoPath: string
): Promise<AppBskyEmbedVideo.Main> {
  const { data: serviceAuth } = await agent.com.atproto.server.getServiceAuth({
    aud: `did:web:${agent.dispatchUrl.host}`,
    lxm: 'com.atproto.repo.uploadBlob',
    exp: Date.now() / 1000 + 60 * 30, // 30 minutes
  });

  async function downloadVideo(
    url: string
  ): Promise<{ video: Buffer; size: number }> {
    // Known proxy gap: VPN egress not applied (module-scope helper, no `this`).
    // SSRF is still covered — this uses safeFetch (isSafePublicHttpsUrl +
    // per-hop re-validation) — but the per-channel VPN dispatcher is skipped.
    // This is a post media (video) download, not a provider API call.
    const response = await safeFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const video = Buffer.from(arrayBuffer);
    const size = video.length;
    return { video, size };
  }

  const video = await downloadVideo(videoPath);

  const uploadUrl = new URL(
    'https://video.bsky.app/xrpc/app.bsky.video.uploadVideo'
  );
  uploadUrl.searchParams.append('did', agent.session!.did);
  uploadUrl.searchParams.append('name', videoPath.split('/').pop()!);

  // Known proxy gap: module-scope helper (no `this`) so SocialAbstract.fetch()
  // (timeout/retry + per-channel VPN egress) is unreachable here. Routed through
  // safeFetch so it still gets ssrfSafeDispatcher + per-hop re-validation; the
  // per-channel VPN selection does not apply to the Bluesky video upload. Fixed
  // first-party host (low SSRF risk). See README "Known proxy gap".
  const uploadResponse = await safeFetch(uploadUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceAuth.token}`,
      'Content-Type': 'video/mp4',
      'Content-Length': video.size.toString(),
    },
    body: video.video,
  });

  const jobStatus = (await uploadResponse.json()) as AppBskyVideoDefs.JobStatus;
  let blob: BlobRef | undefined = jobStatus.blob;
  const videoAgent = new AtpAgent({ service: 'https://video.bsky.app' });

  // Bluesky video blob processing can hang; cap both attempts and wall-clock
  // time so a stuck job fails terminally instead of polling forever.
  const maxAttempts = 20; // 20 × 30s = 10 minutes
  const deadline = Date.now() + 10 * 60 * 1000;
  let attempts = 0;

  while (!blob) {
    if (attempts >= maxAttempts || Date.now() > deadline) {
      throw new BadBody(
        'bluesky',
        JSON.stringify({}),
        {} as any,
        'Could not upload video, blob processing timed out'
      );
    }

    const { data: status } = await videoAgent.app.bsky.video.getJobStatus({
      jobId: jobStatus.jobId,
    });
    attempts++;

    if (status.jobStatus.blob) {
      blob = status.jobStatus.blob;
    }

    if (status.jobStatus.state === 'JOB_STATE_FAILED') {
      throw new BadBody(
        'bluesky',
        JSON.stringify({}),
        {} as any,
        'Could not upload video, job failed'
      );
    }

    await timer(30000);
  }

  return {
    $type: 'app.bsky.embed.video',
    video: blob,
  } satisfies AppBskyEmbedVideo.Main;
}

@Rules(
  'Bluesky can have maximum 1 video or 4 pictures in one post, it can also be without attachments'
)
export class BlueskyProvider extends SocialAbstract implements SocialProvider {
  private readonly logger = new Logger(BlueskyProvider.name);
  override maxConcurrentJob = 2; // Bluesky has moderate rate limits
  identifier = 'bluesky';
  name = 'Bluesky';
  toolTip = "We don’t currently support two-factor authentication. If it’s enabled on Bluesky, you’ll need to disable it."
  isBetweenSteps = false;
  scopes = ['write:statuses', 'profile', 'write:media'];
  editor = 'normal' as const;
  maxLength() {
    return 300;
  }

  override async checkValidity(
    posts: Array<ValidityMedia[]>
  ): Promise<string | true> {
    if (
      posts?.some(
        (p) =>
          p?.some((a) => (a?.path?.indexOf?.('mp4') ?? -1) > -1) &&
          (p?.length ?? 0) > 1
      )
    ) {
      return 'You can only upload one video per post.';
    }

    if (posts?.some((p) => (p?.length ?? 0) > 4)) {
      return 'There can be maximum 4 pictures in a post.';
    }
    return true;
  }

  async customFields() {
    return [
      {
        key: 'service',
        label: 'Service',
        defaultValue: 'https://bsky.social',
        validation: `/^(https?:\\/\\/)?((([a-zA-Z0-9\\-_]{1,256}\\.[a-zA-Z]{2,6})|(([0-9]{1,3}\\.){3}[0-9]{1,3}))(:[0-9]{1,5})?)(\\/[^\\s]*)?$/`,
        type: 'text' as const,
      },
      {
        key: 'identifier',
        label: 'Identifier',
        validation: `/^.+$/`,
        type: 'text' as const,
      },
      {
        key: 'password',
        label: 'Password',
        validation: `/^.{3,}$/`,
        type: 'password' as const,
      },
    ];
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeOauthState();
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    let body: { service: string; identifier: string; password: string };
    try {
      body = validateBlueskyCallback(JSON.parse(Buffer.from(params.code, 'base64').toString()));
    } catch (err) {
      this.logger.warn('Bluesky callback validation failed');
      return 'Invalid credentials';
    }

    try {
      // Known proxy gap: the @atproto/api BskyAgent owns its own HTTP client and
      // cannot accept a custom undici dispatcher, so all agent traffic (login,
      // getProfile, post, comments) bypasses both ssrfSafeDispatcher and
      // per-channel VPN egress. Not faked. See README "Known proxy gap".
      const agent = new BskyAgent({
        service: body.service,
      });

      const {
        data: { accessJwt, refreshJwt, handle, did },
      } = await agent.login({
        identifier: body.identifier,
        password: body.password,
      });

      const profile = await agent.getProfile({
        actor: did,
      });

      return {
        refreshToken: refreshJwt,
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: accessJwt,
        id: did,
        name: profile.data.displayName || '',
        picture: profile?.data?.avatar || '',
        username: profile.data.handle || '',
      };
    } catch (e) {
      this.logger.warn('Bluesky authentication failed');
      return 'Invalid credentials';
    }
  }

  private async getAgent(integration: Integration) {
    const body = JSON.parse(
      AuthService.fixedDecryption(integration.customInstanceDetails!)
    );
    // Known proxy gap: this is the shared chokepoint for the BskyAgent used by
    // every posting path. @atproto/api cannot accept a custom undici dispatcher,
    // so all of its traffic bypasses ssrfSafeDispatcher + per-channel VPN egress.
    // Not faked. See README "Known proxy gap".
    const agent = new BskyAgent({
      service: body.service,
    });

    try {
      await agent.login({
        identifier: body.identifier,
        password: body.password,
      });
    } catch (err) {
      throw new RefreshToken('bluesky', JSON.stringify(err), {} as BodyInit);
    }

    return agent;
  }

  private async uploadMediaForPost(
    agent: BskyAgent,
    post: PostDetails
  ): Promise<{ embed: any; images: any[] }> {
    // Separate images and videos
    const imageMedia =
      post.media?.filter((p) => !hasExtension(p.path, 'mp4')) || [];
    const videoMedia =
      post.media?.filter((p) => hasExtension(p.path, 'mp4')) || [];

    // Upload images
    const images = await Promise.all(
      imageMedia.map(async (p) => {
        const { buffer, width, height } = await reduceImageBySize(p.path);
        return {
          width,
          height,
          buffer: await agent.uploadBlob(new Blob([buffer])),
        };
      })
    );

    // Upload videos (only one video per post is supported by Bluesky)
    let videoEmbed: AppBskyEmbedVideo.Main | null = null;
    if (videoMedia.length > 0) {
      videoEmbed = await uploadVideo(agent, videoMedia[0].path);
    }

    // Determine embed based on media types
    let embed: any = {};
    if (videoEmbed) {
      embed = videoEmbed;
    } else if (images.length > 0) {
      embed = {
        $type: 'app.bsky.embed.images',
        images: images.map((p, index) => ({
          alt: imageMedia?.[index]?.alt || '',
          image: p.buffer.data.blob,
          aspectRatio: {
            width: p.width,
            height: p.height,
          },
        })),
      };
    }

    return { embed, images };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const agent = await this.getAgent(integration);
    const [firstPost] = postDetails;

    const { embed } = await this.uploadMediaForPost(agent, firstPost);

    const rt = new RichText({
      text: firstPost.message,
    });

    await rt.detectFacets(agent);

    // @ts-ignore
    const { cid, uri, commit } = await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
      ...(Object.keys(embed).length > 0 ? { embed } : {}),
    });

    return [
      {
        id: firstPost.id,
        postId: uri,
        status: 'completed',
        releaseURL: `https://bsky.app/profile/${id}/post/${uri.split('/').pop()}`,
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const agent = await this.getAgent(integration);
    const [commentPost] = postDetails;

    const { embed } = await this.uploadMediaForPost(agent, commentPost);

    const rt = new RichText({
      text: commentPost.message,
    });

    await rt.detectFacets(agent);

    // Get the parent post info to get its CID
    const parentUri = lastCommentId || postId;

    // Fetch the parent post to get its CID
    const parentThread = await agent.getPostThread({
      uri: parentUri,
      depth: 0,
    });

    // @ts-ignore
    const parentCid = parentThread.data.thread.post?.cid;
    // @ts-ignore
    const rootUri = parentThread.data.thread.post?.record?.reply?.root?.uri || postId;
    // @ts-ignore
    const rootCid = parentThread.data.thread.post?.record?.reply?.root?.cid || parentCid;

    // @ts-ignore
    const { cid, uri, commit } = await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
      ...(Object.keys(embed).length > 0 ? { embed } : {}),
      reply: {
        root: {
          uri: rootUri,
          cid: rootCid,
        },
        parent: {
          uri: parentUri,
          cid: parentCid,
        },
      },
    });

    return [
      {
        id: commentPost.id,
        postId: uri,
        status: 'completed',
        releaseURL: `https://bsky.app/profile/${id}/post/${uri.split('/').pop()}`,
      },
    ];
  }

  override get commentsCapabilities() {
    return { read: true, reply: true, like: true };
  }

  // Append any link targets carried in Bluesky rich-text facets that aren't
  // already visible in the text, so URLs aren't lost to truncated display text.
  private blueskyContentWithLinks(record: any): string {
    const text: string = record?.text || '';
    const facets: any[] = record?.facets || [];
    const links: string[] = [];

    for (const facet of facets) {
      for (const feature of facet?.features || []) {
        const uri = feature?.uri;
        if (
          uri &&
          feature?.$type?.includes('link') &&
          !text.includes(uri) &&
          !links.includes(uri)
        ) {
          links.push(uri);
        }
      }
    }

    return links.length ? `${text}\n${links.join('\n')}`.trim() : text;
  }

  // Bluesky returns the thread as a tree (each reply may carry its own
  // `replies`). Flatten it so nested replies aren't dropped.
  private flattenBlueskyReplies(
    replies: any[],
    out: SocialCommentDTO[] = [],
    depth = 0,
    maxDepth = 6
  ): SocialCommentDTO[] {
    if (depth >= maxDepth) return out;

    for (const r of replies || []) {
      const post = r?.post;
      if (!post) continue;

      out.push({
        platformCommentId: post.uri,
        parentPlatformCommentId: post.record?.reply?.parent?.uri || undefined,
        author: {
          id: post.author?.did || '',
          name: post.author?.displayName || post.author?.handle || '',
          username: post.author?.handle,
          picture: post.author?.avatar,
          profileUrl: `https://bsky.app/profile/${post.author?.did}`,
        },
        content: this.blueskyContentWithLinks(post.record),
        createdAt: post.record?.createdAt || post.indexedAt,
        likeCount: post.likeCount,
        replyCount: post.replyCount,
        likedByMe: !!post.viewer?.like,
        raw: r,
      });

      if (Array.isArray(r.replies) && r.replies.length) {
        this.flattenBlueskyReplies(r.replies, out, depth + 1, maxDepth);
      }
    }

    return out;
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    cursor: string | undefined,
    integration: Integration
  ) {
    try {
      const agent = await this.getAgent(integration);

      const thread = await agent.getPostThread({
        uri: postId,
        depth: 6,
      });

      // @ts-ignore
      const replies = thread.data.thread?.replies || [];

      const comments = this.flattenBlueskyReplies(replies);

      return { comments };
    } catch (err) {
      this.logger.error(
        `Bluesky fetchComments error: ${(err as Error)?.message || 'unknown'}`
      );
      return { comments: [] };
    }
  }

  async replyToComment(
    id: string,
    accessToken: string,
    postId: string,
    parentCommentId: string,
    message: string,
    integration: Integration
  ) {
    try {
      const agent = await this.getAgent(integration);

      const rt = new RichText({ text: message });
      await rt.detectFacets(agent);

      const parentThread = await agent.getPostThread({
        uri: parentCommentId,
        depth: 0,
      });

      // @ts-ignore
      const parentCid = parentThread.data.thread.post?.cid;
      // @ts-ignore
      const rootUri = parentThread.data.thread.post?.record?.reply?.root?.uri || postId;
      // @ts-ignore
      const rootCid = parentThread.data.thread.post?.record?.reply?.root?.cid || parentCid;

      // @ts-ignore
      const { uri } = await agent.post({
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
        reply: {
          root: { uri: rootUri, cid: rootCid },
          parent: { uri: parentCommentId, cid: parentCid },
        },
      });

      const handle = agent.session?.handle || '';
      const profile = await agent.getProfile({ actor: agent.session?.did || '' });
      const displayName = profile.data.displayName || handle;

      return {
        platformCommentId: uri,
        parentPlatformCommentId: parentCommentId,
        author: {
          id: agent.session?.did || '',
          name: displayName,
          username: handle,
          picture: profile.data.avatar,
          profileUrl: `https://bsky.app/profile/${handle}`,
        },
        content: message,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error(
        `Bluesky replyToComment error: ${(err as Error)?.message || 'unknown'}`
      );
      return {
        platformCommentId: '',
        parentPlatformCommentId: parentCommentId,
        author: {
          id: '',
          name: '',
          username: '',
        },
        content: message,
        createdAt: new Date().toISOString(),
      };
    }
  }

  async likeComment(
    id: string,
    accessToken: string,
    postId: string,
    commentId: string,
    like: boolean,
    integration: Integration
  ) {
    try {
      const agent = await this.getAgent(integration);

      if (like) {
        const thread = await agent.getPostThread({
          uri: commentId,
          depth: 0,
        });

        // @ts-ignore
        const commentCid = thread.data.thread.post?.cid;
        if (!commentCid) {
          return { liked: false };
        }

        await agent.like(commentId, commentCid);
        return { liked: true };
      } else {
        // Page through likes — the caller's like may not be on the first page.
        // Most likes are recent; cap at 5 pages to bound API cost.
        const myDid = agent.session?.did;
        let likesCursor: string | undefined;
        for (let page = 0; page < 5; page++) {
          const likes = await agent.app.bsky.feed.getLikes({
            uri: commentId,
            cursor: likesCursor,
          });

          // @ts-ignore
          const myLike = likes.data.likes?.find(
            // @ts-ignore
            (l: any) => l.actor?.did === myDid
          );

          if (myLike) {
            // @ts-ignore
            await agent.deleteLike(myLike.uri);
            break;
          }

          // @ts-ignore
          likesCursor = likes.data.cursor;
          if (!likesCursor) break;
        }

        return { liked: false };
      }
    } catch (err) {
      this.logger.error(
        `Bluesky likeComment error: ${(err as Error)?.message || 'unknown'}`
      );
      throw err;
    }
  }

  @Plug({
    identifier: 'bluesky-autoRepostPost',
    title: 'Auto Repost Posts',
    description:
      'When a post reached a certain number of likes, repost it to increase engagement (1 week old posts)',
    runEveryMilliseconds: 21600000,
    totalRuns: 3,
    fields: [
      {
        name: 'likesAmount',
        type: 'number',
        placeholder: 'Amount of likes',
        description: 'The amount of likes to trigger the repost',
        validation: /^\d+$/,
      },
    ],
  })
  async autoRepostPost(
    integration: Integration,
    id: string,
    fields: { likesAmount: string }
  ) {
    const body = JSON.parse(
      AuthService.fixedDecryption(integration.customInstanceDetails!)
    );
    const agent = new BskyAgent({
      service: body.service,
    });

    await agent.login({
      identifier: body.identifier,
      password: body.password,
    });

    const getThread = await agent.getPostThread({
      uri: id,
      depth: 0,
    });

    // @ts-ignore
    if (getThread.data.thread.post?.likeCount >= +fields.likesAmount) {
      await timer(2000);
      await agent.repost(
        // @ts-ignore
        getThread.data.thread.post?.uri,
        // @ts-ignore
        getThread.data.thread.post?.cid
      );
      return true;
    }

    return false;
  }

  @Plug({
    identifier: 'bluesky-autoPlugPost',
    title: 'Auto plug post',
    description:
      'When a post reached a certain number of likes, add another post to it so you followers get a notification about your promotion',
    runEveryMilliseconds: 21600000,
    totalRuns: 3,
    fields: [
      {
        name: 'likesAmount',
        type: 'number',
        placeholder: 'Amount of likes',
        description: 'The amount of likes to trigger the repost',
        validation: /^\d+$/,
      },
      {
        name: 'post',
        type: 'richtext',
        placeholder: 'Post to plug',
        description: 'Message content to plug',
        validation: /^[\s\S]{3,}$/g,
      },
    ],
  })
  async autoPlugPost(
    integration: Integration,
    id: string,
    fields: { likesAmount: string; post: string }
  ) {
    const body = JSON.parse(
      AuthService.fixedDecryption(integration.customInstanceDetails!)
    );
    const agent = new BskyAgent({
      service: body.service,
    });

    await agent.login({
      identifier: body.identifier,
      password: body.password,
    });

    const getThread = await agent.getPostThread({
      uri: id,
      depth: 0,
    });

    // @ts-ignore
    if (getThread.data.thread.post?.likeCount >= +fields.likesAmount) {
      await timer(2000);
      const rt = new RichText({
        text: stripHtmlValidation('normal', fields.post, true),
      });

      await agent.post({
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
        reply: {
          root: {
            // @ts-ignore
            uri: getThread.data.thread.post?.uri,
            // @ts-ignore
            cid: getThread.data.thread.post?.cid,
          },
          parent: {
            // @ts-ignore
            uri: getThread.data.thread.post?.uri,
            // @ts-ignore
            cid: getThread.data.thread.post?.cid,
          },
        },
      });
      return true;
    }

    return false;
  }

  override async mention(
    token: string,
    d: { query: string },
    id: string,
    integration: Integration
  ) {
    const body = JSON.parse(
      AuthService.fixedDecryption(integration.customInstanceDetails!)
    );

    const agent = new BskyAgent({
      service: body.service,
    });

    await agent.login({
      identifier: body.identifier,
      password: body.password,
    });

    const list = await agent.searchActors({
      q: d.query,
    });

    return list.data.actors.map((p) => ({
      label: p.displayName,
      id: p.handle,
      image: p.avatar,
    }));
  }

  mentionFormat(idOrHandle: string, name: string) {
    return `@${idOrHandle}`;
  }

  // Unauthenticated public appview agent for read-only analytics. Known proxy
  // gap: @atproto/api owns its HTTP client and cannot accept a custom undici
  // dispatcher, so this read bypasses ssrfSafeDispatcher + per-channel VPN
  // egress — the same documented gap as the posting agent. Fixed first-party
  // host, public API only (no credentials).
  private getPublicAgent(): AtpAgent {
    return new AtpAgent({ service: 'https://public.api.bsky.app' });
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    try {
      const agent = this.getPublicAgent();
      const profile = await agent.app.bsky.actor.getProfile({ actor: id });
      const followers = profile?.data?.followersCount;
      if (followers === undefined || followers === null) {
        return [];
      }
      return [
        {
          label: 'Followers',
          data: [
            { total: String(followers), date: dayjs().format('YYYY-MM-DD') },
          ],
        },
      ];
    } catch (err) {
      this.logger.warn('Bluesky analytics failed');
      return [];
    }
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    try {
      const agent = this.getPublicAgent();
      const res = await agent.app.bsky.feed.getPosts({ uris: [postId] });
      const post = res?.data?.posts?.[0] as any;
      if (!post) {
        return [];
      }

      const today = dayjs().format('YYYY-MM-DD');
      const result: AnalyticsData[] = [];
      const push = (label: string, value: unknown) => {
        if (value !== undefined && value !== null) {
          result.push({ label, data: [{ total: String(value), date: today }] });
        }
      };

      push('Likes', post.likeCount);
      push('Reposts', post.repostCount);
      push('Replies', post.replyCount);

      return result;
    } catch (err) {
      this.logger.warn('Bluesky postAnalytics failed');
      return [];
    }
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new BlueskyProvider();

export const blueskySocialModule: __ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'social',
    providerId: __adapter.identifier,
    version: 'v1',
    displayName: __adapter.name,
    status: 'active',
    credentialFields: [],
    capabilities: (__CAPS as any)[__adapter.identifier] || {},
  },
  create: (ctx) => new __Bridge(__adapter, ctx),
};
