'use client';

import DevtoProvider from '@gitroom/frontend/components/composer/providers/devto/devto.provider';
import XProvider from '@gitroom/frontend/components/composer/providers/x/x.provider';
import LinkedinProvider from '@gitroom/frontend/components/composer/providers/linkedin/linkedin.provider';
import RedditProvider from '@gitroom/frontend/components/composer/providers/reddit/reddit.provider';
import MediumProvider from '@gitroom/frontend/components/composer/providers/medium/medium.provider';
import HashnodeProvider from '@gitroom/frontend/components/composer/providers/hashnode/hashnode.provider';
import FacebookProvider from '@gitroom/frontend/components/composer/providers/facebook/facebook.provider';
import InstagramProvider from '@gitroom/frontend/components/composer/providers/instagram/instagram.collaborators';
import YoutubeProvider from '@gitroom/frontend/components/composer/providers/youtube/youtube.provider';
import TiktokProvider from '@gitroom/frontend/components/composer/providers/tiktok/tiktok.provider';
import PinterestProvider from '@gitroom/frontend/components/composer/providers/pinterest/pinterest.provider';
import DribbbleProvider from '@gitroom/frontend/components/composer/providers/dribbble/dribbble.provider';
import ThreadsProvider from '@gitroom/frontend/components/composer/providers/threads/threads.provider';
import DiscordProvider from '@gitroom/frontend/components/composer/providers/discord/discord.provider';
import SlackProvider from '@gitroom/frontend/components/composer/providers/slack/slack.provider';
import KickProvider from '@gitroom/frontend/components/composer/providers/kick/kick.provider';
import TwitchProvider from '@gitroom/frontend/components/composer/providers/twitch/twitch.provider';
import MastodonProvider from '@gitroom/frontend/components/composer/providers/mastodon/mastodon.provider';
import BlueskyProvider from '@gitroom/frontend/components/composer/providers/bluesky/bluesky.provider';
import LemmyProvider from '@gitroom/frontend/components/composer/providers/lemmy/lemmy.provider';
import WarpcastProvider from '@gitroom/frontend/components/composer/providers/warpcast/warpcast.provider';
import TelegramProvider from '@gitroom/frontend/components/composer/providers/telegram/telegram.provider';
import NostrProvider from '@gitroom/frontend/components/composer/providers/nostr/nostr.provider';
import VkProvider from '@gitroom/frontend/components/composer/providers/vk/vk.provider';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';
import { useShallow } from 'zustand/react/shallow';
import React, { FC, forwardRef, useEffect, useImperativeHandle } from 'react';
import { GeneralPreviewComponent } from '@gitroom/frontend/components/launches/general.preview.component';
import { IntegrationContext } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PostComment } from '@gitroom/frontend/components/composer/providers/high.order.provider';
import WordpressProvider from '@gitroom/frontend/components/composer/providers/wordpress/wordpress.provider';
import ListmonkProvider from '@gitroom/frontend/components/composer/providers/listmonk/listmonk.provider';
import GmbProvider from '@gitroom/frontend/components/composer/providers/gmb/gmb.provider';
import MoltbookProvider from '@gitroom/frontend/components/composer/providers/moltbook/moltbook.provider';
import SkoolProvider from '@gitroom/frontend/components/composer/providers/skool/skool.provider';
import WhopProvider from '@gitroom/frontend/components/composer/providers/whop/whop.provider';
import MeweProvider from '@gitroom/frontend/components/composer/providers/mewe/mewe.provider';
import TumblrProvider from '@gitroom/frontend/components/composer/providers/tumblr/tumblr.provider';
import PixelfedProvider from '@gitroom/frontend/components/composer/providers/pixelfed/pixelfed.provider';
import PeerTubeProvider from '@gitroom/frontend/components/composer/providers/peertube/peertube.provider';

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
