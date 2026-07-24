'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@postmill-ai/frontend/components/composer/providers/high.order.provider';
import { useSettings } from '@postmill-ai/frontend/components/launches/helpers/use.values';
import { PinterestBoard } from '@postmill-ai/frontend/components/composer/providers/pinterest/pinterest.board';
import { PinterestSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/pinterest.dto';
import { Input } from '@postmill-ai/react/form/input';
import { ColorPicker } from '@postmill-ai/react/form/color.picker';
import { PinterestPreview } from '@postmill-ai/frontend/components/composer/providers/pinterest/pinterest.preview';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
const PinterestSettings: FC = () => {
  const { register, control } = useSettings();
  const t = useT();
  return (
    <div className="flex flex-col">
      <Input label={t('label_title', 'Title')} {...register('title')} />
      <Input label={t('link', 'Link')} {...register('link')} />
      <PinterestBoard {...register('board')} />
      <ColorPicker
        label={t('select_pin_color', 'Select Pin Color')}
        name="dominant_color"
        enabled={false}
        canBeCancelled={true}
      />
    </div>
  );
};
export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  comments: false,
  SettingsComponent: PinterestSettings,
  CustomPreviewComponent: PinterestPreview,
  dto: PinterestSettingsDto,
  maximumCharacters: 500,
});
