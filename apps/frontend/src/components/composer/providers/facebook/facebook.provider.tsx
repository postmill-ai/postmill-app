'use client';

import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import { FacebookDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { Input } from '@postmill-ai/react/form/input';
import { Select } from '@postmill-ai/react/form/select';
import { useSettings } from '@postmill-ai/frontend/components/launches/helpers/use.values';
import { FacebookPreview } from '@postmill-ai/frontend/components/composer/providers/facebook/facebook.preview';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { FirstCommentField } from '@postmill-ai/frontend/components/composer/providers/shared/first-comment.field';

const postType = [
  {
    value: 'post',
    label: 'Post',
    labelKey: 'post',
  },
  {
    value: 'story',
    label: 'Story',
    labelKey: 'story',
  },
];

export const FacebookSettings = () => {
  const t = useT();
  const { register, watch } = useSettings();
  const postCurrentType = watch('post_type');

  return (
    <>
      <Select
        label={t('label_post_type', 'Post Type')}
        {...register('post_type', {
          value: 'post',
        })}
      >
        <option value="">{t('select_post_type', 'Select Post Type...')}</option>
        {postType.map((item) => (
          <option key={item.value} value={item.value}>
            {t(item.labelKey, item.label)}
          </option>
        ))}
      </Select>

      {postCurrentType !== 'story' && (
        <Input
          label={t(
            'embedded_url_label',
            'Embedded URL (only for text Post)'
          )}
          {...register('url')}
        />
      )}

      <FirstCommentField />
    </>
  );
};

export default withProvider<FacebookDto>({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: FacebookSettings,
  CustomPreviewComponent: FacebookPreview,
  dto: FacebookDto,
  maximumCharacters: 63206,
});
