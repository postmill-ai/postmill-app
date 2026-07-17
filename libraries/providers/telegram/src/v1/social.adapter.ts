import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialCommentDTO,
  SocialProvider,
} from '@gitroom/provider-kernel';
import { makeId, makeOauthState } from '@gitroom/provider-kernel';
import dayjs from 'dayjs';
import { SocialAbstract } from '@gitroom/provider-kernel';
//@ts-ignore
import mime from 'mime';
import TelegramBot from 'node-telegram-bot-api';
import { Integration } from '@prisma/client';
import striptags from 'striptags';
import { getOrgCredential } from '@gitroom/provider-kernel';
import { ClientInformation } from '@gitroom/provider-kernel';
import { Logger } from '@nestjs/common';

import { metadata as providerMetadata } from './metadata';
export class TelegramProvider extends SocialAbstract implements SocialProvider {
  private readonly logger = new Logger(TelegramProvider.name);
  override maxConcurrentJob = 3; // Telegram has moderate bot API limits
  identifier = 'telegram';
  name = 'Telegram';
  isBetweenSteps = false;
  isWeb3 = true;
  scopes = [] as string[];
  editor = 'html' as const;

  private createBot(token: string): TelegramBot {
    return new TelegramBot(token);
  }
  maxLength() {
    return 4096;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
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

  async authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ) {
    const bot = this.createBot(clientInformation?.client_id || '');
    const chat = await bot.getChat(params.code);

    if (!chat?.id) {
      return 'No chat found';
    }

    const photo = !chat?.photo?.big_file_id
      ? ''
      : await bot.getFileLink(chat.photo.big_file_id);

    // Modified id to work with chat.username (public groups/channels) or chat.id (private groups/channels) when chat.username is not available
    return {
      id: String(chat.username ? chat.username : chat.id),
      name: chat.title!,
      accessToken: String(chat.id),
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: photo || '',
      username: chat.username!,
    };
  }

  async getBotId(query: { id?: number; word: string }, integration?: Integration) {
    const orgId = integration?.organizationId || '';
    const bot = this.createBot(
      (orgId ? (getOrgCredential(orgId, this.identifier, 'clientId') || '') : '')
    );
    // Added allowed_updates Ensure only necessary updates are fetched
    const res = await bot.getUpdates({
      ...(query.id ? { offset: query.id } : {}),
      allowed_updates: ['message', 'channel_post'],
    });
    //message.text is for groups, channel_post.text is for channels
    const match = res.find(
      (p) =>
        (p?.message?.text === `/connect ${query.word}` &&
          p?.message?.chat?.id) ||
        (p?.channel_post?.text === `/connect ${query.word}` &&
          p?.channel_post?.chat?.id)
    );
    // get correct chatId based on the channel type
    const chatId = match?.message?.chat?.id || match?.channel_post?.chat?.id;

    // prevents the code from running while chatId is still undefined to avoid the error 'ETELEGRAM: 400 Bad Request: chat_id is empty'. the code would still work eventually but console spam is not pretty
    if (chatId) {
      //get the numberic ID of the bot
      const botId = (await bot.getMe()).id;
      // check if the bot is an admin in the chat
      const isAdmin = await this.botIsAdmin(chatId, botId, orgId);
      // get the messageId of the message that triggered the connection
      const connectMessageId =
        match?.message?.message_id || match?.channel_post?.message_id;

      if (!isAdmin) {
        // alternatively you can replace this with a console.log if you do not want to inform the user of the bot's admin status
        bot.sendMessage(
          chatId,
          "Connection Successful. I don't have admin privileges to delete these messages, please go ahead and remove them yourself."
        );
      } else {
        // Delete the message that triggered the connection
        await bot.deleteMessage(chatId, connectMessageId);
        // Send success message to the chat
        const successMessage = await bot.sendMessage(
          chatId,
          'Connection Successful. Message will be deleted in 10 seconds.'
        );
        // Delete the success message after 10 seconds
        setTimeout(async () => {
          await bot.deleteMessage(chatId, successMessage.message_id);
          console.log('Success message deleted.');
        }, 10000);
      }
    }

    // modified lastChatId to work with any type of channel (private/public groups/channels)
    return chatId
      ? { chatId }
      : res.length > 0
      ? {
          lastChatId: res[res.length - 1].update_id + 1,
        }
      : {};
  }

  private processMedia(mediaFiles: PostDetails['media']) {
    return (mediaFiles || []).map((media) => {
      let mediaUrl = media.path;
      if (mediaUrl.startsWith(process.env.FRONTEND_URL || 'http://localhost:5000')) {
        mediaUrl = mediaUrl.replace(process.env.FRONTEND_URL || 'http://localhost:5000', '');
      }
      //get mime type to pass contentType to telegram api.
      //some photos and videos might not pass telegram api restrictions, so they are sent as documents instead of returning errors
      const mimeType = mime.getType(mediaUrl); // Detect MIME type
      let mediaType: 'photo' | 'video' | 'document';

      if (mimeType?.startsWith('image/')) {
        mediaType = 'photo';
      } else if (mimeType?.startsWith('video/')) {
        mediaType = 'video';
      } else {
        mediaType = 'document';
      }

      return {
        type: mediaType,
        media: mediaUrl,
        fileOptions: {
          filename: media.path.split('/').pop(),
          contentType: mimeType || 'application/octet-stream',
        },
      };
    });
  }

  private async sendMessage(
    accessToken: string,
    message: PostDetails,
    replyToMessageId?: number,
    botToken?: string
  ): Promise<number | null> {
    const bot = this.createBot(botToken || '');
    let messageId: number | null = null;
    const mediaFiles = message.media || [];
    const text = striptags(message.message || '', ['u', 'strong', 'p'])
      .replace(/<strong>/g, '<b>')
      .replace(/<\/strong>/g, '</b>')
      .replace(/<p>(.*?)<\/p>/g, '$1\n');

    const processedMedia = this.processMedia(mediaFiles);

    // if there's no media, bot sends a text message only
    if (processedMedia.length === 0) {
      const response = await bot.sendMessage(accessToken, text, {
        parse_mode: 'HTML',
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      });
      messageId = response.message_id;
    }
    // if there's only one media, bot sends the media with the text message as caption
    else if (processedMedia.length === 1) {
      const media = processedMedia[0];
      const options = {
        caption: text,
        parse_mode: 'HTML' as const,
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      };
      const response =
        media.type === 'video'
          ? await bot.sendVideo(
              accessToken,
              media.media,
              options,
              media.fileOptions
            )
          : media.type === 'photo'
          ? await bot.sendPhoto(
              accessToken,
              media.media,
              options,
              media.fileOptions
            )
          : await bot.sendDocument(
              accessToken,
              media.media,
              options,
              media.fileOptions
            );
      messageId = response.message_id;
    }
    // if there are multiple media, bot sends them as a media group - max 10 media per group - with the text as a caption (if there are more than 1 group, the caption will only be sent with the first group)
    else {
      const mediaGroups = this.chunkMedia(processedMedia, 10);
      for (let i = 0; i < mediaGroups.length; i++) {
        const mediaGroup = mediaGroups[i].map((m, index) => ({
          type: m.type === 'document' ? 'document' : m.type, // Documents are not allowed in media groups
          media: m.media,
          caption: i === 0 && index === 0 ? text : undefined,
          parse_mode: 'HTML',
        }));

        const response = await bot.sendMediaGroup(
          accessToken,
          mediaGroup as any[],
          {
            ...(replyToMessageId && i === 0
              ? { reply_to_message_id: replyToMessageId }
              : {}),
          }
        );
        if (i === 0) {
          messageId = response[0].message_id;
        }
      }
    }

    return messageId;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    const messageId = await this.sendMessage(accessToken, firstPost, undefined, clientInformation?.client_id || '');

    // for private groups/channels message.id is undefined so the link generated by Postmill will be unusable "https://t.me/c/undefined/16"
    // to avoid that, we use accessToken instead of message.id and we generate the link manually removing the -100 from the start.
    if (messageId) {
      return [
        {
          id: firstPost.id,
          postId: String(messageId),
          releaseURL: `https://t.me/${
            id !== 'undefined' ? id : `c/${accessToken.replace('-100', '')}`
          }/${messageId}`,
          status: 'completed',
        },
      ];
    }

    return [];
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
    const [commentPost] = postDetails;
    const replyToId = Number(lastCommentId || postId);

    const messageId = await this.sendMessage(accessToken, commentPost, replyToId, clientInformation?.client_id || '');

    if (messageId) {
      return [
        {
          id: commentPost.id,
          postId: String(messageId),
          releaseURL: `https://t.me/${
            id !== 'undefined' ? id : `c/${accessToken.replace('-100', '')}`
          }/${messageId}`,
          status: 'completed',
        },
      ];
    }

    return [];
  }
  // chunkMedia is used to split media into groups of "size". 10 is used here because telegram api allows a maximum of 10 media per group
  private chunkMedia(media: { type: string; media: string }[], size: number) {
    const result = [];
    for (let i = 0; i < media.length; i += size) {
      result.push(media.slice(i, i + size));
    }
    return result;
  }

  override get commentsCapabilities() {
    return { read: true, reply: true, like: false };
  }

  async fetchComments(
    id: string,
    accessToken: string,
    postId: string,
    cursor: string | undefined,
    integration: Integration,
    clientInformation?: ClientInformation
  ): Promise<{ comments: SocialCommentDTO[]; nextCursor?: string }> {
    const bot = this.createBot(clientInformation?.client_id || '');
    try {
      const chatId = accessToken;
      const offset = cursor ? parseInt(cursor, 10) : undefined;
      const updates = await bot.getUpdates({
        offset,
        allowed_updates: ['message'],
        limit: 100,
      });

      const comments: SocialCommentDTO[] = updates
        .filter((u) => {
          const msg = u.message || u.channel_post;
          return msg && (msg.reply_to_message?.message_id === parseInt(postId, 10));
        })
        .map((u) => {
          const msg = u.message || u.channel_post!;
          return {
            platformCommentId: String(msg.message_id),
            parentPlatformCommentId: String(postId),
            author: {
              id: String(msg.from?.id || ''),
              name: msg.from?.first_name || '',
              username: msg.from?.username,
            },
            content: msg.text || msg.caption || '',
            createdAt: new Date((msg.date || 0) * 1000).toISOString(),
            raw: msg,
          };
        });

      const nextCursor = updates.length > 0
        ? String(updates[updates.length - 1].update_id + 1)
        : undefined;

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
    const bot = this.createBot(clientInformation?.client_id || '');
    try {
      const chatId = accessToken;
      const response = await bot.sendMessage(chatId, message, {
        reply_to_message_id: parseInt(parentCommentId, 10),
        parse_mode: 'HTML',
      });

      return {
        platformCommentId: String(response.message_id),
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
    } catch (err) {
      return {
        platformCommentId: '',
        parentPlatformCommentId: parentCommentId,
        author: {
          id: integration?.internalId || '',
          name: integration?.name || '',
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
  ): Promise<{ liked: boolean; likeCount?: number }> {
    // Platform does not support native comment likes
    return { liked: like };
  }

  // Channel-level analytics: subscriber (member) count via the Bot API's
  // getChatMemberCount. `accessToken` is the chat id (see authenticate()).
  // Per-post `views` are NOT retrievable through the Bot API (they require
  // MTProto) — see su-provider-analytics.md, so there is no postAnalytics().
  async analytics(
    id: string,
    accessToken: string,
    date: number,
    clientInformation?: ClientInformation
  ): Promise<AnalyticsData[]> {
    try {
      const bot = this.createBot(clientInformation?.client_id || '');
      const count = await bot.getChatMemberCount(accessToken);
      if (count === undefined || count === null) {
        return [];
      }
      return [
        {
          label: 'Followers',
          data: [
            { total: String(count), date: dayjs().format('YYYY-MM-DD') },
          ],
        },
      ];
    } catch (err) {
      this.logger.warn('Telegram analytics failed');
      return [];
    }
  }

  async botIsAdmin(chatId: number, botId: number, orgId?: string): Promise<boolean> {
    const bot = this.createBot(
      (orgId ? (getOrgCredential(orgId, this.identifier, 'clientId') || '') : '')
    );
    try {
      const chatMember = await bot.getChatMember(chatId, botId);

      if (
        chatMember.status === 'administrator' ||
        chatMember.status === 'creator'
      ) {
        const permissions = (chatMember as any).can_delete_messages;
        return !!permissions; // Return true if bot can delete messages
      }

      return false;
    } catch (error) {
      console.error(
        'Error checking bot privileges:',
        (error as Error)?.message || 'unknown'
      );
      return false;
    }
  }
}

// ---- provider-kernel module (relocated step 7.5.1) ----
import {
  ProviderModule as __ProviderModule,
  SocialProviderKernelAdapter as __Bridge,
  PROVIDER_CAPABILITIES as __CAPS,
} from '@gitroom/provider-kernel';

const __adapter = new TelegramProvider();

export const telegramSocialModule: __ProviderModule<any, any> = {
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
