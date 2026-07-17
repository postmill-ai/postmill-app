'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { TwitchDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/twitch.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Select } from '@gitroom/react/form/select';
import { useWatch } from 'react-hook-form';
import { FirstCommentField } from '@gitroom/frontend/components/composer/providers/shared/first-comment.field';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const messageTypes = [
  {
    label: 'Chat Message',
    value: 'message',
  },
  {
    label: 'Announcement',
    value: 'announcement',
  },
];

const announcementColors = [
  {
    label: 'Primary (Default)',
    value: 'primary',
  },
  {
    label: 'Blue',
    value: 'blue',
  },
  {
    label: 'Green',
    value: 'green',
  },
  {
    label: 'Orange',
    value: 'orange',
  },
  {
    label: 'Purple',
    value: 'purple',
  },
];

const messageTypeLabelKeys: Record<string, string> = {
  message: 'chat_message',
  announcement: 'announcement',
};

const announcementColorLabelKeys: Record<string, string> = {
  primary: 'primary_default',
  blue: 'blue',
  green: 'green',
  orange: 'orange',
  purple: 'purple',
};

const TwitchSettings: FC = () => {
  const { register, control } = useSettings();
  const translate = useT();
  const messageType = useWatch({
    control,
    name: 'messageType',
  });

  return (
    <div className="flex flex-col">
      <Select
        label={translate('message_type', 'Message Type')}
        {...register('messageType', {
          value: 'message',
        })}
      >
        {messageTypes.map((t) => (
          <option key={t.value} value={t.value}>
            {translate(messageTypeLabelKeys[t.value], t.label)}
          </option>
        ))}
      </Select>
      {messageType === 'announcement' && (
        <Select
          label={translate('announcement_color', 'Announcement Color')}
          {...register('announcementColor', {
            value: 'primary',
          })}
        >
          {announcementColors.map((c) => (
            <option key={c.value} value={c.value}>
              {translate(announcementColorLabelKeys[c.value], c.label)}
            </option>
          ))}
        </Select>
      )}
      <FirstCommentField />
    </div>
  );
};

export default withProvider({
  postComment: PostComment.COMMENT,
  comments: 'no-media',
  minimumCharacters: [],
  SettingsComponent: TwitchSettings,
  CustomPreviewComponent: undefined,
  dto: TwitchDto,
  maximumCharacters: 500,
});
