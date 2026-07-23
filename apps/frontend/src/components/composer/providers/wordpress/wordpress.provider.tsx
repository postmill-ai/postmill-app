'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import { Input } from '@postmill-ai/react/form/input';
import { useSettings } from '@postmill-ai/frontend/components/launches/helpers/use.values';
import { WordpressPostType } from '@postmill-ai/frontend/components/composer/providers/wordpress/wordpress.post.type';
import { FileComponent } from '@postmill-ai/frontend/components/files/file.component';
import { WordpressDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/wordpress.dto';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

const WordpressSettings: FC = () => {
  const form = useSettings();
  const t = useT();
  return (
    <>
      <Input label={t('label_title', 'Title')} {...form.register('title')} />
      <WordpressPostType {...form.register('type')} />
      <FileComponent
        label={t('label_cover_picture', 'Cover picture')}
        description={t('add_a_cover_picture', 'Add a cover picture')}
        {...form.register('main_image')}
      />
    </>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: WordpressSettings,
  CustomPreviewComponent: undefined, // WordpressPreview,
  dto: WordpressDto,
  maximumCharacters: 100000,
});
