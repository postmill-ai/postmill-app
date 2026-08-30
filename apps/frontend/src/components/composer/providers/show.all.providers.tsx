'use client';

import DevtoProvider from '@postmill-ai/frontend/components/composer/providers/devto/devto.provider';
import XProvider from '@postmill-ai/frontend/components/composer/providers/x/x.provider';
import LinkedinProvider from '@postmill-ai/frontend/components/composer/providers/linkedin/linkedin.provider';
import RedditProvider from '@postmill-ai/frontend/components/composer/providers/reddit/reddit.provider';
import MediumProvider from '@postmill-ai/frontend/components/composer/providers/medium/medium.provider';
import HashnodeProvider from '@postmill-ai/frontend/components/composer/providers/hashnode/hashnode.provider';
import FacebookProvider from '@postmill-ai/frontend/components/composer/providers/facebook/facebook.provider';
import InstagramProvider from '@postmill-ai/frontend/components/composer/providers/instagram/instagram.collaborators';
import YoutubeProvider from '@postmill-ai/frontend/components/composer/providers/youtube/youtube.provider';
import TiktokProvider from '@postmill-ai/frontend/components/composer/providers/tiktok/tiktok.provider';
import PinterestProvider from '@postmill-ai/frontend/components/composer/providers/pinterest/pinterest.provider';
import DribbbleProvider from '@postmill-ai/frontend/components/composer/providers/dribbble/dribbble.provider';
import ThreadsProvider from '@postmill-ai/frontend/components/composer/providers/threads/threads.provider';
import DiscordProvider from '@postmill-ai/frontend/components/composer/providers/discord/discord.provider';
import SlackProvider from '@postmill-ai/frontend/components/composer/providers/slack/slack.provider';
import KickProvider from '@postmill-ai/frontend/components/composer/providers/kick/kick.provider';
import TwitchProvider from '@postmill-ai/frontend/components/composer/providers/twitch/twitch.provider';
import MastodonProvider from '@postmill-ai/frontend/components/composer/providers/mastodon/mastodon.provider';
import GoToSocialProvider from '@postmill-ai/frontend/components/composer/providers/gotosocial/gotosocial.provider';
import AkkomaProvider from '@postmill-ai/frontend/components/composer/providers/akkoma/akkoma.provider';
import FriendicaProvider from '@postmill-ai/frontend/components/composer/providers/friendica/friendica.provider';
import OdyseeProvider from '@postmill-ai/frontend/components/composer/providers/odysee/odysee.provider';
import MisskeyProvider from '@postmill-ai/frontend/components/composer/providers/misskey/misskey.provider';
import SharkeyProvider from '@postmill-ai/frontend/components/composer/providers/sharkey/sharkey.provider';
import LineProvider from '@postmill-ai/frontend/components/composer/providers/line/line.provider';
import MatrixProvider from '@postmill-ai/frontend/components/composer/providers/matrix/matrix.provider';
import DiscourseProvider from '@postmill-ai/frontend/components/composer/providers/discourse/discourse.provider';
import BlueskyProvider from '@postmill-ai/frontend/components/composer/providers/bluesky/bluesky.provider';
import LemmyProvider from '@postmill-ai/frontend/components/composer/providers/lemmy/lemmy.provider';
import WarpcastProvider from '@postmill-ai/frontend/components/composer/providers/warpcast/warpcast.provider';
import TelegramProvider from '@postmill-ai/frontend/components/composer/providers/telegram/telegram.provider';
import NostrProvider from '@postmill-ai/frontend/components/composer/providers/nostr/nostr.provider';
import VkProvider from '@postmill-ai/frontend/components/composer/providers/vk/vk.provider';
import { useLaunchStore } from '@postmill-ai/frontend/components/composer/store';
import { useShallow } from 'zustand/react/shallow';
import React, { FC, forwardRef, useEffect, useImperativeHandle } from 'react';
import { GeneralPreviewComponent } from '@postmill-ai/frontend/components/launches/general.preview.component';
import { IntegrationContext } from '@postmill-ai/frontend/components/launches/helpers/use.integration';
import { Button } from '@postmill-ai/react/form/button';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { PostComment } from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import WordpressProvider from '@postmill-ai/frontend/components/composer/providers/wordpress/wordpress.provider';
import ListmonkProvider from '@postmill-ai/frontend/components/composer/providers/listmonk/listmonk.provider';
import GmbProvider from '@postmill-ai/frontend/components/composer/providers/gmb/gmb.provider';
import MoltbookProvider from '@postmill-ai/frontend/components/composer/providers/moltbook/moltbook.provider';
import SkoolProvider from '@postmill-ai/frontend/components/composer/providers/skool/skool.provider';
import WhopProvider from '@postmill-ai/frontend/components/composer/providers/whop/whop.provider';
import MeweProvider from '@postmill-ai/frontend/components/composer/providers/mewe/mewe.provider';
import TumblrProvider from '@postmill-ai/frontend/components/composer/providers/tumblr/tumblr.provider';
import PixelfedProvider from '@postmill-ai/frontend/components/composer/providers/pixelfed/pixelfed.provider';
import PeerTubeProvider from '@postmill-ai/frontend/components/composer/providers/peertube/peertube.provider';

export const Providers = [
  {
    identifier: 'devto',
    component: DevtoProvider,
  },
  {
    identifier: 'x',
    component: XProvider,
  },
  {
    identifier: 'linkedin',
    component: LinkedinProvider,
  },
  {
    identifier: 'linkedin-page',
    component: LinkedinProvider,
  },
  {
    identifier: 'reddit',
    component: RedditProvider,
  },
  {
    identifier: 'medium',
    component: MediumProvider,
  },
  {
    identifier: 'hashnode',
    component: HashnodeProvider,
  },
  {
    identifier: 'facebook',
    component: FacebookProvider,
  },
  {
    identifier: 'instagram',
    component: InstagramProvider,
  },
  {
    identifier: 'instagram-standalone',
    component: InstagramProvider,
  },
  {
    identifier: 'youtube',
    component: YoutubeProvider,
  },
  {
    identifier: 'tiktok',
    component: TiktokProvider,
  },
  {
    identifier: 'pinterest',
    component: PinterestProvider,
  },
  {
    identifier: 'dribbble',
    component: DribbbleProvider,
  },
  {
    identifier: 'threads',
    component: ThreadsProvider,
  },
  {
    identifier: 'discord',
    component: DiscordProvider,
  },
  {
    identifier: 'slack',
    component: SlackProvider,
  },
  {
    identifier: 'kick',
    component: KickProvider,
  },
  {
    identifier: 'twitch',
    component: TwitchProvider,
  },
  {
    identifier: 'mastodon',
    component: MastodonProvider,
  },
  {
    identifier: 'gotosocial',
    component: GoToSocialProvider,
  },
  {
    identifier: 'akkoma',
    component: AkkomaProvider,
  },
  {
    identifier: 'friendica',
    component: FriendicaProvider,
  },
  {
    identifier: 'odysee',
    component: OdyseeProvider,
  },
  {
    identifier: 'misskey',
    component: MisskeyProvider,
  },
  {
    identifier: 'sharkey',
    component: SharkeyProvider,
  },
  {
    identifier: 'line',
    component: LineProvider,
  },
  {
    identifier: 'matrix',
    component: MatrixProvider,
  },
  {
    identifier: 'discourse',
    component: DiscourseProvider,
  },
  {
    identifier: 'bluesky',
    component: BlueskyProvider,
  },
  {
    identifier: 'lemmy',
    component: LemmyProvider,
  },
  {
    identifier: 'wrapcast',
    component: WarpcastProvider,
  },
  {
    identifier: 'telegram',
    component: TelegramProvider,
  },
  {
    identifier: 'nostr',
    component: NostrProvider,
  },
  {
    identifier: 'vk',
    component: VkProvider,
  },
  {
    identifier: 'wordpress',
    component: WordpressProvider,
  },
  {
    identifier: 'listmonk',
    component: ListmonkProvider,
  },
  {
    identifier: 'gmb',
    component: GmbProvider,
  },
  {
    identifier: 'moltbook',
    component: MoltbookProvider,
  },
  {
    identifier: 'skool',
    component: SkoolProvider,
  },
  {
    identifier: 'whop',
    component: WhopProvider,
  },
  {
    identifier: 'mewe',
    component: MeweProvider,
  },
  {
    identifier: 'tumblr',
    component: TumblrProvider,
  },
  {
    identifier: 'pixelfed',
    component: PixelfedProvider,
  },
  {
    identifier: 'peertube',
    component: PeerTubeProvider,
  },
];
export const ShowAllProviders = forwardRef(function ShowAllProviders(props, ref) {
  const { date, current, global, selectedIntegrations, allIntegrations } =
    useLaunchStore(
      useShallow((state) => ({
        date: state.date,
        selectedIntegrations: state.selectedIntegrations,
        allIntegrations: state.integrations,
        current: state.current,
        global: state.global,
      }))
    );

  const t = useT();

  useImperativeHandle(ref, () => ({
    checkAllValid: async () => {
      return Promise.all(
        selectedIntegrations.map(async (p) => await p.ref?.current.isValid())
      );
    },
    getAllValues: async () => {
      return Promise.all(
        selectedIntegrations.map(async (p) => await p.ref?.current.getValues())
      );
    },
    triggerAll: () => {
      return selectedIntegrations.map(
        async (p) => await p.ref?.current.trigger()
      );
    },
  }));

  return (
    <div className="w-full flex flex-col flex-1">
      {current === 'global' && (
        <IntegrationContext.Provider
          value={{
            date,
            integration:
              selectedIntegrations?.[0]?.integration || allIntegrations?.[0],
            allIntegrations: selectedIntegrations.map((p) => p.integration),
            value: global.map((p) => ({
              id: p.id,
              content: p.content,
              image: p.media,
            })),
          }}
        >
          {global?.[0]?.content?.length === 0 ? (
            <div>
              {t(
                'start_writing_your_post',
                'Start writing your post for a preview'
              )}
            </div>
          ) : (
            <div className="border border-borderPreview rounded-[12px] shadow-previewShadow">
              <GeneralPreviewComponent maximumCharacters={100000000} />
            </div>
          )}
        </IntegrationContext.Provider>
      )}
      {selectedIntegrations.map((integration) => {
        const { component: ProviderComponent } = Providers.find(
          (provider) =>
            provider.identifier === integration.integration.identifier
        ) || {
          component: Empty,
        };

        return (
          <ProviderComponent
            ref={integration.ref}
            key={integration.integration.id}
            id={integration.integration.id}
          />
        );
      })}
    </div>
  );
});

export const Empty: FC = () => {
  return null;
};
