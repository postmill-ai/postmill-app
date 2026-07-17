'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import { useAddProvider } from '@gitroom/frontend/components/launches/add.provider.component';
import { KebabMenu } from '@gitroom/frontend/components/ui/kebab-menu';

interface CampaignChannel {
  id: string;
  name: string;
  picture: string | null;
  providerIdentifier: string;
  postCount: number;
}

export const CampaignChannelsSection: FC<{
  campaignId: string;
  channels: CampaignChannel[];
  onMutate: () => void;
}> = ({ campaignId, channels, onMutate }) => {
  const t = useT();
  const addChannel = useAddProvider(onMutate, false, campaignId);
  const inviteClient = useAddProvider(onMutate, true, campaignId);

  return (
    <div className="flex flex-col gap-[16px] p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor">
      <div className="flex items-center justify-between gap-[12px]">
        <div className="flex flex-col">
          <h2 className="text-[16px] font-semibold text-textColor">
            {t('channels', 'Channels')}
          </h2>
          <span className="text-[12px] text-newTableText">
            {t('campaign_channels_hint', 'Channels this campaign publishes to')}
          </span>
        </div>
        <KebabMenu
          ariaLabel={t('channel_actions', 'Channel actions')}
          items={[
            { label: t('add_channel', 'Add Channel'), onClick: addChannel },
            { label: t('invite_client', 'Invite Client'), onClick: inviteClient },
          ]}
        />
      </div>

      {channels.length === 0 ? (
        <div className="text-[13px] text-newTableText py-[8px]">
          {t(
            'no_campaign_channels',
            'No channels yet. Add a channel or invite a client to connect one.'
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[8px]">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="flex items-center gap-[10px] px-[12px] py-[8px] rounded-[8px] bg-newBgColorInner border border-newTableBorder min-w-0"
            >
              <ProviderIcon
                identifier={channel.providerIdentifier}
                name={channel.name}
                size={28}
              />
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] text-textColor truncate">{channel.name}</span>
                <span className="text-[11px] text-newTableText">
                  {channel.postCount === 1
                    ? t('one_post', '1 post')
                    : t('n_posts', '{{count}} posts', { count: channel.postCount })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
