'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { FC } from 'react';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { SlackChannelSelect } from '@gitroom/frontend/components/composer/providers/slack/slack.channel.select';
import { SlackDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/slack.dto';
import { FirstCommentField } from '@gitroom/frontend/components/composer/providers/shared/first-comment.field';
const SlackComponent: FC = () => {
  const form = useSettings();
  return (
    <div>
      <SlackChannelSelect {...form.register('channel')} />
      <FirstCommentField />
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: SlackComponent,
  CustomPreviewComponent: undefined,
  dto: SlackDto,
  maximumCharacters: 400000,
});
