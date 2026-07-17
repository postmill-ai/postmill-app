import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialCommentDTO,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import { SocialAbstract } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { DiscordDto } from '@gitroom/provider-kernel';
import { Tool } from '@gitroom/provider-kernel';
import { getOrgCredential } from '@gitroom/provider-kernel';
import { safeFetch } from '@gitroom/provider-kernel';
import { Logger } from '@nestjs/common';

import { metadata as providerMetadata } from './metadata';

export const DISCORD_MENTION_MARKER_REGEX = /\[\[\[(@[^\[\]]*)]]]/g;

export class DiscordProvider extends SocialAbstract implements SocialProvider {
  private readonly logger = new Logger(DiscordProvider.name);
  override maxConcurrentJob = 5; // Discord has generous rate limits for webhook posting
  identifier = 'discord';
  name = 'Discord';
  isBetweenSteps = false;
  editor = 'markdown' as const;
  scopes = ['identify', 'guilds'];
  maxLength() {
    return 1980;
  }
  dto = DiscordDto;

  async refreshToken(refreshToken: string, clientInformation?: ClientInformation): Promise<AuthTokenDetails> {
    const clientId = clientInformation?.client_id || '';
    const clientSecret = clientInformation?.client_secret || '';
    const { access_token, expires_in, refresh_token } = await (
      await this.fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            clientId + ':' + clientSecret
          ).toString('base64')}`,
        },
      })
    ).json();

    const { application } = await (
      await this.fetch('https://discord.com/api/oauth2/@me', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      refreshToken: refresh_token,
      expiresIn: expires_in,
      accessToken: access_token,
      id: '',
      name: application.name,
      picture: '',
      username: '',
    };
  }
  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = makeOauthState();
    return {
      url: `https://discord.com/oauth2/authorize?client_id=${
        clientInformation?.client_id || ''
      }&permissions=377957124096&response_type=code&redirect_uri=${encodeURIComponent(
        `${process.env.FRONTEND_URL}/integrations/social/discord`
      )}&integration_type=0&scope=bot+identify+guilds&state=${state}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }, clientInformation?: ClientInformation) {
    const clientId = clientInformation?.client_id || '';
    const clientSecret = clientInformation?.client_secret || '';
    const { access_token, expires_in, refresh_token, scope, guild } = await (
      await this.fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          code: params.code,
          grant_type: 'authorization_code',
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/discord`,
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            clientId + ':' + clientSecret
          ).toString('base64')}`,
        },
      })
    ).json();

    this.checkScopes(this.scopes, scope.split(' '));

    const { application } = await (
      await this.fetch('https://discord.com/api/oauth2/@me', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: guild.id,
      name: application.name,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      picture: `https://cdn.discordapp.com/avatars/${application?.bot?.id}/${application?.bot?.avatar}.png`,
      username: application?.bot?.username,
    };
  }

  @Tool({ description: 'Channels', dataSchema: [] })
  async channels(accessToken: string, params: any, id: string, integration?: Integration) {
    const botToken = integration
      ? getOrgCredential(integration.organizationId, 'discord', 'token') || ''
      : '';
    const list = await (
      await this.fetch(`https://discord.com/api/guilds/${id}/channels`, {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      })
    ).json();

    return list
      .filter((p: any) => p.type === 0 || p.type === 5 || p.type === 15)
      .map((p: any) => ({
        id: String(p.id),
        name: p.name,
      }));
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration?: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const channel = firstPost.settings.channel;
    const botToken = clientInformation?.token || '';

    const form = new FormData();
    form.append(
      'payload_json',
      JSON.stringify({
        content: firstPost.message.replace(DISCORD_MENTION_MARKER_REGEX, (match, p1) => {
          return `<${p1}>`;
        }),
        attachments: firstPost.media?.map((p, index) => ({
          id: index,
          description: `Picture ${index}`,
          filename: p.path.split('/').pop(),
        })),
      })
    );

    let index = 0;
    for (const media of firstPost.media || []) {
      const loadMedia = await safeFetch(media.path);

      form.append(
        `files[${index}]`,
        await loadMedia.blob(),
        media.path.split('/').pop()
      );
      index++;
    }

    const data = await (
      await this.fetch(`https://discord.com/api/channels/${channel}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
        },
        body: form,
      })
    ).json();

    return [
      {
        id: firstPost.id,
        releaseURL: `https://discord.com/channels/${id}/${channel}/${data.id}`,
        postId: data.id,
        status: 'success',
      },
    ];
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
    const [firstPost] = postDetails;
    const channel = firstPost.settings.channel;
    const botToken = clientInformation?.token || '';

    // For Discord, we create a thread from the original message for comments
    // If we don't have a thread yet, create one
    let threadChannel = channel;

    // Create thread if this is the first comment
    if (!lastCommentId) {
      const { id: threadId } = await (
        await this.fetch(
          `https://discord.com/api/channels/${channel}/messages/${postId}/threads`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bot ${botToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: 'Thread',
              auto_archive_duration: 1440,
            }),
          }
        )
      ).json();
      threadChannel = threadId;
    }

    const form = new FormData();
    form.append(
      'payload_json',
      JSON.stringify({
        content: firstPost.message.replace(DISCORD_MENTION_MARKER_REGEX, (match, p1) => {
            return `<${p1}>`;
        }),
        attachments: firstPost.media?.map((p, index) => ({
          id: index,
          description: `Picture ${index}`,
          filename: p.path.split('/').pop(),
        })),
      })
    );

    let index = 0;
    for (const media of firstPost.media || []) {
      const loadMedia = await safeFetch(media.path);

      form.append(
        `files[${index}]`,
        await loadMedia.blob(),
        media.path.split('/').pop()
      );
      index++;
    }

    const data = await (
      await this.fetch(
        `https://discord.com/api/channels/${threadChannel}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bot ${botToken}`,
          },
          body: form,
        }
      )
    ).json();

    return [
      {
        id: firstPost.id,
        releaseURL: `https://discord.com/channels/${id}/${threadChannel}/${data.id}`,
        postId: data.id,
        status: 'success',
      },
    ];
  }

  async changeNickname(id: string, accessToken: string, name: string, integration?: Integration) {
    const botToken = integration
      ? getOrgCredential(integration.organizationId, 'discord', 'token') || ''
      : '';
    await (
      await this.fetch(`https://discord.com/api/guilds/${id}/members/@me`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nick: name,
        }),
      })
    ).json();

    return {
      name,
    };
  }

  override async mention(
    token: string,
    data: { query: string },
    id: string,
    integration: Integration
  ) {
    const botToken = getOrgCredential(integration.organizationId, 'discord', 'token') || '';
    const allRoles = await (
      await this.fetch(`https://discord.com/api/guilds/${id}/roles`, {
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
      })
    ).json();

    const matching = allRoles
      .filter((role: any) =>
        role.name.toLowerCase().includes(data.query.toLowerCase())
      )
      .filter((f: any) => f.name !== '@everyone' && f.name !== '@here');

    const list = await (
      await this.fetch(
        `https://discord.com/api/guilds/${id}/members/search?query=${data.query}`,
        {
          headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
        }
      )
    ).json();

    return [
      ...[
        {
          id: String('here'),
          label: 'here',
          image: '',
          doNotCache: true,
        },
        {
          id: String('everyone'),
          label: 'everyone',
          image: '',
          doNotCache: true,
        },
      ].filter((role: any) => {
        return role.label.toLowerCase().includes(data.query.toLowerCase());
      }),
      ...matching.map((p: any) => ({
        id: String('&' + p.id),
        label: p.name.split('@')[1],
        image: '',
        doNotCache: true,
      })),
      ...list.map((p: any) => ({
        id: String(p.user.id),
        label: p.user.global_name || p.user.username,
        image: `https://cdn.discordapp.com/avatars/${p.user.id}/${p.user.avatar}.png`,
      })),
    ];
  }

  mentionFormat(idOrHandle: string, name: string) {
    if (name === '@here' || name === '@everyone') {
      return name;
    }
    return `[[[@${idOrHandle.replace('@', '')}]]]`;
  }

  override get commentsCapabilities() {
    return { read: true, reply: true, like: true };
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    cursor: string | undefined,
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
    try {
      const botToken = clientInformation?.token || '';
      let url = `https://discord.com/api/channels/${id}/messages?limit=100`;
      if (cursor) {
        url += `&before=${cursor}`;
      }

      const response = await this.fetch(url, {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      });
      const messages = await response.json() as any[];

      const comments: SocialCommentDTO[] = (messages || []).map((msg: any) => ({
        platformCommentId: msg.id,
        author: {
          id: msg.author?.id || '',
          name: msg.author?.global_name || msg.author?.username || '',
          username: msg.author?.username,
          picture: msg.author?.avatar
            ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png`
            : undefined,
        },
        content: msg.content || '',
        createdAt: msg.timestamp,
        likeCount: msg.reactions?.reduce((sum: number, r: any) => sum + (r.count || 0), 0) || 0,
        raw: msg,
      }));

      const nextCursor = messages?.length > 0 ? messages[messages.length - 1].id : undefined;
      return { comments, nextCursor };
    } catch (err) {
      return { comments: [] };
    }
  }

  async replyToComment(
    id: string,
    accessToken: string,
    postId: string,
    parentCommentId: string,
    message: string,
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<SocialCommentDTO> {
    const botToken = clientInformation?.token || '';
    const channel = id;
    const response = await this.fetch(
      `https://discord.com/api/channels/${channel}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: message,
          message_reference: { message_id: parentCommentId },
        }),
      }
    );
    const data = await response.json() as any;

    return {
      platformCommentId: data.id,
      parentPlatformCommentId: parentCommentId,
      author: {
        id: integration.internalId,
        name: integration.name,
        username: integration.profile,
        picture: integration.picture,
      },
      content: message,
      createdAt: new Date().toISOString(),
    };
  }

  async likeComment(
    id: string,
    accessToken: string,
    postId: string,
    commentId: string,
    like: boolean,
    integration: Integration
  ): Promise<{ liked: boolean; likeCount?: number }> {
    try {
      const channel = id;
      const emoji = '👍';
      if (like) {
        await this.fetch(
          `https://discord.com/api/channels/${channel}/messages/${commentId}/reactions/${encodeURIComponent(emoji)}/@me`,
          { method: 'PUT' }
        );
      } else {
        await this.fetch(
          `https://discord.com/api/channels/${channel}/messages/${commentId}/reactions/${encodeURIComponent(emoji)}/@me`,
          { method: 'DELETE' }
        );
      }
      return { liked: like };
    } catch (err) {
      return { liked: like };
    }
  }

  // Channel-level analytics: guild member counts via the bot token. `id` is the
  // guild id (internalId) and the bot token rides on clientInformation.token
  // (same as post()). Discord messages carry no per-post view metric, so there
  // is no postAnalytics().
  async analytics(
    id: string,
    accessToken: string,
    date: number,
    clientInformation?: ClientInformation
  ): Promise<AnalyticsData[]> {
    try {
      const botToken = clientInformation?.token || '';
      const guild = (await (
        await this.fetch(
          `https://discord.com/api/guilds/${id}?with_counts=true`,
          {
            headers: {
              Authorization: `Bot ${botToken}`,
            },
          }
        )
      ).json()) as any;

      const today = dayjs().format('YYYY-MM-DD');
      const result: AnalyticsData[] = [];
      const push = (label: string, value: unknown) => {
        if (value !== undefined && value !== null) {
          result.push({ label, data: [{ total: String(value), date: today }] });
        }
      };

      push('Members', guild?.approximate_member_count);

      return result;
    } catch (err) {
      this.logger.warn('Discord analytics failed');
      return [];
    }
  }

  override handleErrors(
    body: string
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    if (body.includes('50001')) {
      return {
        type: 'bad-body',
        value: "Bot doesn't have access to this channel",
      };
    }

    if (body.includes('50013')) {
      return {
        type: 'bad-body',
        value: 'Bot lacks permission to send messages in this channel',
      };
    }

    if (body.includes('10003')) {
      return {
        type: 'bad-body',
        value: 'Channel no longer exists',
      };
    }

    if (body.includes('40005')) {
      return {
        type: 'bad-body',
        value: "Attachment exceeds Discord's size limit",
      };
    }

    if (body.includes('20028')) {
      return {
        type: 'retry',
        value: 'Rate limited by Discord',
      };
    }

    return undefined;
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new DiscordProvider();

export const discordSocialModule: __ProviderModule<any, any> = {
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
