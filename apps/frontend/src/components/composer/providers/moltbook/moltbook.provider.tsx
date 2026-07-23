'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import { MoltbookDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/moltbook.dto';
import { useSettings } from '@postmill-ai/frontend/components/launches/helpers/use.values';
import { Input } from '@postmill-ai/react/form/input';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { FirstCommentField } from '@postmill-ai/frontend/components/composer/providers/shared/first-comment.field';

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
