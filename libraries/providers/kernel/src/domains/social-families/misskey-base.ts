import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '../social-provider';
import { SocialCommentDTO } from '../social';
import { makeId, makeOauthState } from '../social-make-id';
import { SocialAbstract, ValidityMedia } from '../social-base';
import { normalizeExternalInstanceUrl } from '../social-external-url';
import dayjs from 'dayjs';
import crypto from 'crypto';
import { Integration } from '@prisma/client';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';
import { Logger } from '@nestjs/common';
import { safeFetch } from '../social-base';

/**
 * Misskey-API family base — shared by every Misskey-fork channel (Misskey,
 * Sharkey, and other Firefish-lineage servers; Firefish itself is
 * discontinued, but its descendants speak the same API). Sharkey is a Misskey
 * soft-fork with an identical API surface, so the package-level subclasses
 * only set identity, limits, the default host fallback, and the setup
 * descriptor.
 *
 * Auth is MiAuth (https://misskey-hub.net/en/docs/for-developers/api/token/miauth/):
 * no app registration. The connect flow generates a session UUID, sends the
 * user to {instance}/miauth/{uuid}?callback=..., Misskey redirects back with
 * `?session={uuid}`, and POST /api/miauth/{uuid}/check exchanges it for the
 * user token. The session UUID doubles as the OAuth `state` capability key —
 * the IntegrationManager stashes it in Redis (`login:`/`organization:`/
 * `external:`) exactly like a Mastodon state, and the frontend callback page
 * maps the `session` query param onto {state, code} for these channels.
 *
 * All HTTP goes through the SocialAbstract fetch port (SSRF-hardened,
 * per-hop revalidation) or the kernel safeFetch port for user-influenced
 * URLs — never bare fetch.
 */
export class MisskeyProvider extends SocialAbstract implements SocialProvider {
  private readonly logger = new Logger(MisskeyProvider.name);
  // Misskey rate limits are instance-configured and generally stricter than
  // Mastodon's — keep the publish pool conservative.
  override maxConcurrentJob = 3;
  identifier = 'misskey';
  name = 'Misskey';
  isBetweenSteps = false;
  // MiAuth permissions requested on the authorize page (comma-joined into the
  // /miauth URL). write:notes = notes/create; write:drive = drive/files/create;
  // read:account = /api/i identity checks. notes/show, notes/children and
  // users/show carry no dedicated permission in the Misskey permission list.
  scopes = ['write:notes', 'write:drive', 'read:account'];
  editor = 'normal' as const;

  // Fallback host when a channel carries no instance details. The MiAuth
  // connect flow always stores one (encrypted customInstanceDetails), so this
  // only guards broken/legacy rows — subclasses set a sensible per-channel
  // default.
  protected defaultInstanceUrl = 'https://misskey.io';

  override get commentsCapabilities() {
    // Misskey reacts with per-emoji reactions, not a plain like — there is no
    // meaningful like/unlike mapping, so the comments surface is read+reply.
    return { read: true, reply: true, like: false };
  }

  // Misskey's default note length cap is 3000 characters
  // (instance-configurable via the maxNoteTextLength policy).
  maxLength() {
    return 3000;
  }

  // Misskey API errors are JSON: {error: {message, code, id, kind}}. Map the
  // well-known codes onto the repo conventions so the publish pipeline
  // distinguishes dead credentials (refresh-token) from a bad request
  // (bad-body) and rate limits (retry).
  override handleErrors(
    body: string,
    status: number
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    let code = '';
    let message = '';
    try {
      const parsed = JSON.parse(body);
      code = parsed?.error?.code || '';
      message = parsed?.error?.message || '';
    } catch {
      return undefined;
    }
    if (!code && !message) {
      return undefined;
    }

    if (
      [
        'CREDENTIALS_REQUIRED',
        'AUTHENTICATION_FAILED',
        'PERMISSION_DENIED',
        'YOUR_ACCOUNT_SUSPENDED',
      ].includes(code)
    ) {
      return { type: 'refresh-token', value: message || code };
    }

    if (code === 'RATE_LIMIT_EXCEEDED') {
      return { type: 'retry', value: message || code };
    }

    return {
      type: 'bad-body',
      value: code ? `${code}: ${message || 'Unknown Error'}` : message,
    };
  }

  // MiAuth tokens do not expire — same stub shape as the Mastodon family base.
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

  // MiAuth needs no app registration, so unlike the Mastodon family base this
  // hook registers nothing — but it still (a) normalizes/validates the
  // user-supplied host through the shared externalUrl contract and (b)
  // verifies the host actually speaks the Misskey API (POST /api/meta is
  // unauthenticated and implemented by Misskey and its forks) via the
  // SSRF-hardened kernel safeFetch port. The manager stashes the returned
  // (empty) credentials plus the instanceUrl in Redis (`external:<state>`)
  // for the callback, which encrypts them onto Integration.customInstanceDetails.
  async externalUrl(
    url: string
  ): Promise<{ client_id: string; client_secret: string }> {
    const instanceUrl = normalizeExternalInstanceUrl(url);

    const response = await safeFetch(`${instanceUrl}/api/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ detail: false }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to reach the ${this.name} API on ${instanceUrl} (HTTP ${response.status})`
      );
    }

    const meta = (await response.json()) as { version?: string };
    if (!meta?.version) {
      throw new Error(
        `${instanceUrl} does not look like a ${this.name}-compatible server`
      );
    }

    return { client_id: '', client_secret: '' };
  }

  // Resolve the instance a connected channel actually lives on — same
  // decrypt-on-read pattern as mastodon-base (and bluesky/lemmy/pixelfed):
  // the encrypted customInstanceDetails blob written by the MiAuth callback is
  // authoritative; org/env clientInformation can belong to a different host.
  protected resolveInstanceUrl(
    integration?: Integration,
    clientInformation?: ClientInformation
  ): string {
    if (integration?.customInstanceDetails) {
      try {
        const details = JSON.parse(
          AuthService.fixedDecryption(integration.customInstanceDetails)
        );
        if (details?.instanceUrl) {
          return details.instanceUrl;
        }
      } catch {
        // Not an externalUrl-shaped blob (or undecryptable) — fall through.
      }
    }
    return clientInformation?.instanceUrl || this.defaultInstanceUrl;
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    // The MiAuth session id is an arbitrary unique string (UUID is only the
    // documented convention; reused sessions are rejected), so the OAuth-state
    // generator doubles as the session id and satisfies the state entropy
    // contract (128-bit CSPRNG — the grep-guard pins makeOauthState()).
    const state = makeOauthState();
    const instanceUrl =
      clientInformation?.instanceUrl || this.defaultInstanceUrl;
    const frontendUrl = (
      process.env.FRONTEND_URL || 'http://localhost:5000'
    ).replace(/\/+$/, '');

    const url =
      `${instanceUrl}/miauth/${state}` +
      `?name=Postmill` +
      `&callback=${encodeURIComponent(
        `${frontendUrl}/integrations/social/${this.identifier}`
      )}` +
      `&permission=${this.scopes.join(',')}`;

    return {
      url,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ) {
    // params.code is the MiAuth session UUID — Misskey appends it to the
    // callback as `?session=`, and the frontend maps it onto {state, code}.
    // Exchange it for the user token via the check endpoint.
    const instanceUrl =
      clientInformation?.instanceUrl || this.defaultInstanceUrl;

    const data = (await (
      await this.fetch(`${instanceUrl}/api/miauth/${params.code}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).json()) as {
      ok?: boolean;
      token?: string;
      user?: {
        id: string;
        name?: string | null;
        username?: string;
        avatarUrl?: string | null;
      };
    };

    if (data.ok === false || !data.token || !data.user?.id) {
      return 'Authorization was denied or the session expired — try connecting again';
    }

    return {
      id: String(data.user.id),
      name: data.user.name || data.user.username || '',
      accessToken: data.token,
      refreshToken: 'null',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      picture: data.user.avatarUrl || '',
      username: data.user.username || '',
    };
  }

  // Media validation: Misskey notes accept at most 16 drive files
  // (notes/create fileIds maxItems). Duration/dimension checks are not
  // re-implemented server-side (repo convention).
  override async checkValidity(
    posts: Array<ValidityMedia[]>
  ): Promise<string | true> {
    if (posts.some((entry) => (entry?.length || 0) > 16)) {
      return `${this.name} notes support up to 16 attachments`;
    }
    return true;
  }

  // Drive upload. This endpoint is multipart-only and takes the token as the
  // `i` form field (Bearer auth is not accepted here). The drive file's
  // `comment` field is the alt text / caption.
  private async uploadDriveFile(
    instanceUrl: string,
    accessToken: string,
    media: { path: string; alt?: string }
  ): Promise<string> {
    const form = new FormData();
    form.append('i', accessToken);
    form.append('file', await safeFetch(media.path).then((r) => r.blob()));
    if (media.alt) {
      form.append('comment', media.alt);
    }
    const file = await (
      await this.fetch(`${instanceUrl}/api/drive/files/create`, {
        method: 'POST',
        body: form,
      })
    ).json();
    return file.id as string;
  }

  private async createNote(
    instanceUrl: string,
    accessToken: string,
    note: { text: string; fileIds?: string[]; replyId?: string }
  ) {
    // Misskey's JSON API carries the token as the `i` body field.
    const created = await (
      await this.fetch(`${instanceUrl}/api/notes/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          i: accessToken,
          text: note.text,
          visibility: 'public',
          ...(note.fileIds?.length ? { fileIds: note.fileIds } : {}),
          ...(note.replyId ? { replyId: note.replyId } : {}),
        }),
      })
    ).json();
    return created.createdNote;
  }

  async dynamicPost(
    id: string,
    accessToken: string,
    url: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    const uploadFiles = await Promise.all(
      firstPost?.media?.map((media) =>
        this.uploadDriveFile(url, accessToken, media)
      ) || []
    );

    const note = await this.createNote(url, accessToken, {
      text: firstPost.message,
      fileIds: uploadFiles,
    });

    return [
      {
        id: firstPost.id,
        postId: note.id,
        releaseURL: `${url}/notes/${note.id}`,
        status: 'completed',
      },
    ];
  }

  async dynamicComment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    url: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const replyToId = lastCommentId || postId;

    const uploadFiles = await Promise.all(
      commentPost?.media?.map((media) =>
        this.uploadDriveFile(url, accessToken, media)
      ) || []
    );

    const note = await this.createNote(url, accessToken, {
      text: commentPost.message,
      fileIds: uploadFiles,
      replyId: replyToId,
    });

    return [
      {
        id: commentPost.id,
        postId: note.id,
        releaseURL: `${url}/notes/${note.id}`,
        status: 'completed',
      },
    ];
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration?: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const instanceUrl = this.resolveInstanceUrl(integration, clientInformation);
    return this.dynamicPost(id, accessToken, instanceUrl, postDetails);
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const instanceUrl = this.resolveInstanceUrl(integration, clientInformation);
    return this.dynamicComment(
      id,
      postId,
      lastCommentId,
      accessToken,
      instanceUrl,
      postDetails
    );
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    _cursor: string | undefined,
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
    try {
      const instanceUrl = this.resolveInstanceUrl(integration, clientInformation);

      const notes = (await (
        await this.fetch(`${instanceUrl}/api/notes/children`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ i: accessToken, noteId: postId, limit: 100 }),
        })
      ).json()) as any[];

      const comments: SocialCommentDTO[] = (notes || []).map((n: any) => ({
        platformCommentId: n.id,
        parentPlatformCommentId: n.replyId || undefined,
        author: {
          id: n.user?.id || '',
          name: n.user?.name || n.user?.username || '',
          // Remote authors are addressed as @user@host on Misskey.
          username: n.user?.username
            ? n.user?.host
              ? `@${n.user.username}@${n.user.host}`
              : n.user.username
            : undefined,
          picture: n.user?.avatarUrl,
          profileUrl: n.user?.username
            ? n.user?.host
              ? `https://${n.user.host}/@${n.user.username}`
              : `${instanceUrl}/@${n.user.username}`
            : undefined,
        },
        // Misskey note text is already plain text (no HTML stripping needed).
        content: n.text || '',
        createdAt: n.createdAt,
        // Reactions are a {emoji: count} map; surface the total as likeCount.
        likeCount: Object.values(n.reactions || {}).reduce(
          (total: number, count: any) => total + Number(count || 0),
          0
        ),
        replyCount: n.repliesCount,
        likedByMe: !!n.myReaction,
        raw: n,
      }));

      return { comments, nextCursor: undefined };
    } catch (err) {
      this.logger.error(
        `${this.name} fetchComments error: ${(err as Error)?.message || String(err)}`
      );
      return { comments: [] };
    }
  }

  async replyToComment(
    id: string,
    accessToken: string,
    _postId: string,
    parentCommentId: string,
    message: string,
    integration: Integration,
    clientInformation?: ClientInformation
  ) {
    try {
      const instanceUrl = this.resolveInstanceUrl(integration, clientInformation);

      const note = await this.createNote(instanceUrl, accessToken, {
        text: message,
        replyId: parentCommentId,
      });

      return {
        platformCommentId: note.id,
        parentPlatformCommentId: note.replyId || parentCommentId,
        author: {
          id: note.user?.id || '',
          name: note.user?.name || note.user?.username || '',
          username: note.user?.username,
          picture: note.user?.avatarUrl,
        },
        content: note.text || message,
        createdAt: note.createdAt,
      };
    } catch (err) {
      this.logger.error(
        `${this.name} replyToComment error: ${(err as Error)?.message || String(err)}`
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

  async analytics(
    id: string,
    accessToken: string,
    date: number,
    clientInformation?: ClientInformation
  ): Promise<AnalyticsData[]> {
    try {
      const instanceUrl = this.resolveInstanceUrl(undefined, clientInformation);
      const user = (await (
        await this.fetch(`${instanceUrl}/api/users/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ i: accessToken, userId: id }),
        })
      ).json()) as any;

      const followers = user?.followersCount;
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
      this.logger.warn(
        `${this.name} analytics failed: ${(err as Error)?.message}`
      );
      return [];
    }
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number,
    clientInformation?: ClientInformation
  ): Promise<AnalyticsData[]> {
    try {
      const instanceUrl = this.resolveInstanceUrl(undefined, clientInformation);
      const note = (await (
        await this.fetch(`${instanceUrl}/api/notes/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ i: accessToken, noteId: postId }),
        })
      ).json()) as any;

      const today = dayjs().format('YYYY-MM-DD');
      const result: AnalyticsData[] = [];
      const push = (label: string, value: unknown) => {
        if (value !== undefined && value !== null) {
          result.push({ label, data: [{ total: String(value), date: today }] });
        }
      };

      // notes/show carries reactions as a {emoji: count} map — report the total.
      const reactionsTotal = note?.reactions
        ? Object.values(note.reactions).reduce(
            (total: number, count: any) => total + Number(count || 0),
            0
          )
        : undefined;
      push('Reactions', reactionsTotal);
      push('Renotes', note?.renoteCount);
      push('Replies', note?.repliesCount);

      return result;
    } catch (err) {
      this.logger.warn(
        `${this.name} postAnalytics failed: ${(err as Error)?.message}`
      );
      return [];
    }
  }
}
