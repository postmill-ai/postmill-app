import { RedditSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/reddit.dto';
import { PinterestSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/pinterest.dto';
import { YoutubeSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { TikTokDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { XDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/x.dto';
import { LemmySettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/lemmy.dto';
import { DribbbleDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';
import { DiscordDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/discord.dto';
import { SlackDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/slack.dto';
import { KickDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/kick.dto';
import { TwitchDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/twitch.dto';
import { InstagramDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { LinkedinDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/linkedin.dto';
import { IsIn } from 'class-validator';
import { MediumSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/medium.settings.dto';
import { DevToSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/dev.to.settings.dto';
import { HashnodeSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/hashnode.settings.dto';
import { WordpressDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/wordpress.dto';
import { ListmonkDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/listmonk.dto';
import { GmbSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/gmb.settings.dto';
import { FarcasterDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/farcaster.dto';
import { FacebookDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { MoltbookDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/moltbook.dto';
import { SkoolDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/skool.dto';
import { WhopDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/whop.dto';
import { MeweDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/mewe.dto';
import { ThreadsSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/threads.settings.dto';

export type ProviderExtension<T extends string, M> = { __type: T } & M;
export type AllProvidersSettings =
  | ProviderExtension<'reddit', RedditSettingsDto>
  | ProviderExtension<'lemmy', LemmySettingsDto>
  | ProviderExtension<'youtube', YoutubeSettingsDto>
  | ProviderExtension<'pinterest', PinterestSettingsDto>
  | ProviderExtension<'dribbble', DribbbleDto>
  | ProviderExtension<'tiktok', TikTokDto>
  | ProviderExtension<'discord', DiscordDto>
  | ProviderExtension<'slack', SlackDto>
  | ProviderExtension<'kick', KickDto>
  | ProviderExtension<'twitch', TwitchDto>
  | ProviderExtension<'x', XDto>
  | ProviderExtension<'linkedin', LinkedinDto>
  | ProviderExtension<'linkedin-page', LinkedinDto>
  | ProviderExtension<'instagram', InstagramDto>
  | ProviderExtension<'instagram-standalone', InstagramDto>
  | ProviderExtension<'medium', MediumSettingsDto>
  | ProviderExtension<'devto', DevToSettingsDto>
  | ProviderExtension<'hashnode', HashnodeSettingsDto>
  | ProviderExtension<'wordpress', WordpressDto>
  | ProviderExtension<'listmonk', ListmonkDto>
  | ProviderExtension<'gmb', GmbSettingsDto>
  | ProviderExtension<'facebook', FacebookDto>
  | ProviderExtension<'wrapcast', FarcasterDto>
  | ProviderExtension<'threads', ThreadsSettingsDto>
  | ProviderExtension<'mastodon', None>
  | ProviderExtension<'gotosocial', None>
  | ProviderExtension<'akkoma', None>
  | ProviderExtension<'friendica', None>
  | ProviderExtension<'odysee', None>
  | ProviderExtension<'misskey', None>
  | ProviderExtension<'sharkey', None>
  | ProviderExtension<'line', None>
  | ProviderExtension<'matrix', None>
  | ProviderExtension<'discourse', None>
  | ProviderExtension<'bluesky', None>
  | ProviderExtension<'telegram', None>
  | ProviderExtension<'nostr', None>
  | ProviderExtension<'moltbook', MoltbookDto>
  | ProviderExtension<'vk', None>
  | ProviderExtension<'skool', SkoolDto>
  | ProviderExtension<'mewe', MeweDto>
  | ProviderExtension<'whop', WhopDto>
  | ProviderExtension<'tumblr', None>
  | ProviderExtension<'pixelfed', None>
  | ProviderExtension<'peertube', None>;

type None = NonNullable<unknown>;

export const allProviders = (setEmpty?: any) => {
  return [
    { value: RedditSettingsDto, name: 'reddit' },
    { value: LemmySettingsDto, name: 'lemmy' },
    { value: YoutubeSettingsDto, name: 'youtube' },
    { value: PinterestSettingsDto, name: 'pinterest' },
    { value: DribbbleDto, name: 'dribbble' },
    { value: TikTokDto, name: 'tiktok' },
    { value: DiscordDto, name: 'discord' },
    { value: SlackDto, name: 'slack' },
    { value: KickDto, name: 'kick' },
    { value: TwitchDto, name: 'twitch' },
    { value: XDto, name: 'x' },
    { value: LinkedinDto, name: 'linkedin' },
    { value: LinkedinDto, name: 'linkedin-page' },
    { value: InstagramDto, name: 'instagram' },
    { value: InstagramDto, name: 'instagram-standalone' },
    { value: MediumSettingsDto, name: 'medium' },
    { value: DevToSettingsDto, name: 'devto' },
    { value: WordpressDto, name: 'wordpress' },
    { value: HashnodeSettingsDto, name: 'hashnode' },
    { value: ListmonkDto, name: 'listmonk' },
    { value: GmbSettingsDto, name: 'gmb' },
    { value: FarcasterDto, name: 'wrapcast' },
    { value: FacebookDto, name: 'facebook' },
    { value: ThreadsSettingsDto, name: 'threads' },
    { value: setEmpty, name: 'mastodon' },
    { value: setEmpty, name: 'gotosocial' },
    { value: setEmpty, name: 'akkoma' },
    { value: setEmpty, name: 'friendica' },
    { value: setEmpty, name: 'odysee' },
    { value: setEmpty, name: 'misskey' },
    { value: setEmpty, name: 'sharkey' },
    { value: setEmpty, name: 'line' },
    { value: setEmpty, name: 'matrix' },
    { value: setEmpty, name: 'discourse' },
    { value: setEmpty, name: 'bluesky' },
    { value: setEmpty, name: 'telegram' },
    { value: setEmpty, name: 'nostr' },
    { value: setEmpty, name: 'vk' },
    { value: MoltbookDto, name: 'moltbook' },
    { value: SkoolDto, name: 'skool' },
    { value: WhopDto, name: 'whop' },
    { value: MeweDto, name: 'mewe' },
    { value: setEmpty, name: 'tumblr' },
    { value: setEmpty, name: 'pixelfed' },
    { value: setEmpty, name: 'peertube' },
  ].filter((f) => f.value);
};

export class EmptySettings {
  @IsIn(allProviders(EmptySettings).map((p) => p.name), {
    message: `"__type" must be ${allProviders(EmptySettings)
      .map((p) => p.name)
      .join(', ')}`,
  })
  __type: string;
}
