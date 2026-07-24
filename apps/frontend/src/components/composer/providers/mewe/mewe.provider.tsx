'use client';

import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import { FC } from 'react';
import { MeweDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/mewe.dto';
import { MeweGroupSelect } from '@postmill-ai/frontend/components/composer/providers/mewe/mewe.group.select';
import { useSettings } from '@postmill-ai/frontend/components/launches/helpers/use.values';
import { Select } from '@postmill-ai/react/form/select';
import { useWatch } from 'react-hook-form';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

const MeweComponent: FC = () => {
  const form = useSettings();
  const t = useT();
  const postType = useWatch({ control: form.control, name: 'postType' });

  return (
    <div>
      <Select
        label={t('post_to', 'Post To')}
        {...form.register('postType')}
      >
        <option value="timeline">{t('my_timeline', 'My Timeline')}</option>
        <option value="group">{t('group', 'Group')}</option>
      </Select>
      {postType === 'group' && (
        <MeweGroupSelect {...form.register('group')} />
      )}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: MeweComponent,
  CustomPreviewComponent: undefined,
  dto: MeweDto,
  maximumCharacters: 63206,
});
