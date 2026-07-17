'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { FC } from 'react';
import { DiscordDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/discord.dto';
import { DiscordChannelSelect } from '@gitroom/frontend/components/composer/providers/discord/discord.channel.select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { FirstCommentField } from '@gitroom/frontend/components/composer/providers/shared/first-comment.field';
const DiscordComponent: FC = () => {
  const form = useSettings();
  return (
    <div>
      <DiscordChannelSelect {...form.register('channel')} />
      <FirstCommentField />
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: DiscordComponent,
  CustomPreviewComponent: undefined,
  dto: DiscordDto,
  maximumCharacters: 1980,
});
