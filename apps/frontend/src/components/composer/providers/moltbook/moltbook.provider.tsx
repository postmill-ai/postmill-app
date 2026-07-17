'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/composer/providers/high.order.provider';
import { MoltbookDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/moltbook.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { FirstCommentField } from '@gitroom/frontend/components/composer/providers/shared/first-comment.field';

const MoltbookSettings: FC = () => {
  const form = useSettings();
  const t = useT();

  return (
    <div>
      <Input
        label={t('submolt', 'Submolt')}
        placeholder={t('moltbook_channel_placeholder', 'general')}
        {...form.register('submolt')}
      />
      <FirstCommentField />
    </div>
  );
};

export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: MoltbookSettings,
  CustomPreviewComponent: undefined,
  dto: MoltbookDto,
  maximumCharacters: 300,
});
